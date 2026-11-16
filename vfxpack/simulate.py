"""Evaluates a template's expressions outside Resolve to check the maths.

Every animated input in this pack is an expression of clip progress, frame
number and the published controls. This module reads a generated .setting,
steps progress from 0 to 1 at several control settings and checks that:

  * every expression evaluates to a finite number or point;
  * mixes stay inside 0..1 and scales stay positive;
  * "cut" effects and Hit/Build/Pulse envelopes leave the picture untouched
    on the frames where they should (so nothing pops at a clip boundary);
  * transitions show only A on the first frame and only B on the last.

It models SimpleExpression arithmetic only. It cannot tell whether Resolve
accepts a tool or an input name, and it says nothing about how a frame looks.
"""

from __future__ import annotations

import itertools
import math
import re

from .luatable import Table, parse
from .validate import REF, _collect

TIMES = [0, 1, 2, 3, 7, 30, 31, 100.5]
STEPS = 20
EPS = 1e-6


class Model:
    def __init__(self, text: str):
        root = parse(text)
        self.ident, self.group = next(iter(root.get("Tools").keyed()))
        self.tools = {info.name: info for info in _collect(self.group)}
        self.controls: list[dict] = []
        self.main_tool = None
        for key, entry in self.group.get("Inputs").keyed():
            tool, source = entry.get("SourceOp"), entry.get("Source")
            if str(key).startswith("MainInput"):
                self.main_tool = self.main_tool or tool
                continue
            info = self.tools[tool]
            combo = (info.table.get("UserControls") or Table()).get(source)
            current = info.inputs.get(source).get("Value")
            if isinstance(combo, Table):
                values = list(range(len(combo.positional())))
            elif entry.get("MinScale") is not None:
                values = [current, entry.get("MinScale"), entry.get("MaxScale")]
            else:
                continue  # points, colours and native menus keep their default
            self.controls.append({"tool": tool, "input": source, "label": entry.get("Name"),
                                  "default": current, "values": values})
        out = self.group.get("Outputs").get("MainOutput1")
        self.chain = self._main_chain(out.get("SourceOp"))

    def _main_chain(self, name: str) -> list[str]:
        chain = []
        while name in self.tools:
            chain.append(name)
            inputs = self.tools[name].inputs
            nxt = inputs.get("Input") or inputs.get("Background")
            name = nxt.get("SourceOp") if isinstance(nxt, Table) else None
        return chain

    def evaluate(self, tool: str, input_id: str, p: float, time: float, overrides: dict):
        if (tool, input_id) in overrides:
            return overrides[(tool, input_id)]
        entry = self.tools[tool].inputs.get(input_id)
        if entry is None:
            raise KeyError(f"{tool}.{input_id} is not set")
        expression = entry.get("Expression")
        if expression is not None:
            return self._run(expression, p, time, overrides)
        source = entry.get("SourceOp")
        if source is not None:
            if self.tools[source].regid == "LUTLookup":
                return p
            raise ValueError(f"{tool}.{input_id} is an image connection")
        value = entry.get("Value")
        if isinstance(value, Table):
            return tuple(value.positional())
        return value

    def _run(self, expression: str, p: float, time: float, overrides: dict):
        code = REF.sub(lambda m: f'ref("{m.group(1)}", "{m.group(2)}")', expression)
        code = code.replace("^", "**")
        scope = {
            "__builtins__": {},
            "ref": lambda t, i: self.evaluate(t, i, p, time, overrides),
            "iif": lambda c, a, b: a if c else b,
            "Point": lambda x, y: (x, y),
            "sin": math.sin, "cos": math.cos, "abs": abs, "floor": math.floor,
            "min": min, "max": max, "pi": math.pi, "time": time,
        }
        return eval(code, scope)  # noqa: S307 - our own generated arithmetic


def _finite(value) -> bool:
    parts = value if isinstance(value, tuple) else (value,)
    return all(isinstance(x, (int, float)) and math.isfinite(x) for x in parts)


def _neutral_problems(model: Model, p: float, time: float, overrides: dict) -> list[str]:
    """Which tools on the picture's path still change the image at this moment."""
    problems = []

    def val(tool, input_id, default):
        if input_id not in model.tools[tool].inputs:
            return default
        return model.evaluate(tool, input_id, p, time, overrides)

    for name in model.chain:
        regid = model.tools[name].regid
        if regid == "Transform":
            cx, cy = val(name, "Center", (0.5, 0.5))
            period = 2 if val(name, "Edges", 0) == 3 else 0  # mirrored tiling repeats every 2
            for label, c in (("x", cx), ("y", cy)):
                off = (c - 0.5) % period if period else c - 0.5
                if min(abs(off), abs(off - period) if period else abs(off)) > EPS:
                    problems.append(f"{name}.Center {label} = {c:.4f}")
            if abs(val(name, "Size", 1) - 1) > EPS:
                problems.append(f"{name}.Size = {val(name, 'Size', 1):.4f}")
            angle = val(name, "Angle", 0) % 360
            if min(angle, 360 - angle) > 1e-4:
                problems.append(f"{name}.Angle = {angle:.3f}")
        elif regid == "DirectionalBlur" and abs(val(name, "Length", 0)) > EPS:
            problems.append(f"{name}.Length = {val(name, 'Length', 0):.4f}")
        elif regid == "Displace" and (abs(val(name, "XRefraction", 0)) > EPS or abs(val(name, "YRefraction", 0)) > EPS):
            problems.append(f"{name}.XRefraction = {val(name, 'XRefraction', 0):.4f}")
        elif regid == "BrightnessContrast" and abs(val(name, "Gain", 1) - 1) > EPS:
            problems.append(f"{name}.Gain = {val(name, 'Gain', 1):.4f}")
        elif regid == "Merge" and abs(val(name, "Blend", 1)) > EPS:
            problems.append(f"{name}.Blend = {val(name, 'Blend', 1):.4f}")
    return problems


def simulate(text: str, kind: str) -> tuple[list[str], int]:
    """Returns (problems, number of evaluations made)."""
    model = Model(text)
    problems: set[str] = set()
    count = 0

    # one control at a time away from its default, plus every dropdown option
    settings = [{}]
    for control in model.controls:
        for value in control["values"]:
            if value != control["default"]:
                settings.append({(control["tool"], control["input"]): value})
    combos = [c for c in model.controls if len(c["values"]) > 3 or c["label"] in ("Envelope", "Direction")]
    sliders = [c for c in model.controls if c not in combos]
    for combo in combos:  # each option against every slider extreme
        for value, slider in itertools.product(combo["values"], sliders):
            for extreme in slider["values"][1:]:
                settings.append({(combo["tool"], combo["input"]): value,
                                 (slider["tool"], slider["input"]): extreme})

    envelope = next((c for c in model.controls if c["label"] == "Envelope"), None)

    for overrides in settings:
        tag = ", ".join(f"{t.split('_')[-1]}.{i}={v}" for (t, i), v in overrides.items()) or "defaults"
        for step in range(STEPS + 1):
            p = step / STEPS
            for time in TIMES:
                for name, info in model.tools.items():
                    for input_id, entry in info.inputs.keyed():
                        if entry.get("Expression") is None:
                            continue
                        count += 1
                        where = f"{name}.{input_id} [{tag}, p={p}, t={time}]"
                        try:
                            value = model.evaluate(name, input_id, p, time, overrides)
                        except Exception as err:  # noqa: BLE001
                            problems.add(f"{name}.{input_id}: cannot evaluate ({err}) [{tag}]")
                            continue
                        if not _finite(value):
                            problems.add(f"{where}: not a finite number: {value!r}")
                        elif input_id in ("Blend", "Mix") and not -EPS <= value <= 1 + EPS:
                            problems.add(f"{name}.{input_id}: leaves 0..1 ({value:.3f}) [{tag}]")
                        elif input_id == "Size" and value <= 0:
                            problems.add(f"{name}.Size: not positive ({value:.3f}) [{tag}]")
                        elif input_id == "Gain" and value < 0:
                            problems.add(f"{name}.Gain: negative ({value:.3f}) [{tag}]")

        try:
            # frames where the picture must be untouched
            ends: list[float] = []
            if kind == "cut":
                ends = [0, 1]
            elif envelope is not None:
                mode = overrides.get((envelope["tool"], envelope["input"]), envelope["default"])
                ends = {0: [1], 1: [0], 2: [0, 1]}.get(mode, [])
            for p in ends:
                for time in TIMES:
                    for problem in _neutral_problems(model, p, time, overrides):
                        problems.add(f"picture not untouched at progress {p}: {problem} [{tag}]")
            if kind == "transition":
                for p, want in ((0, 0), (1, 1)):
                    for name, info in model.tools.items():
                        if info.regid == "Dissolve" and "Background" not in info.inputs:
                            mix = model.evaluate(name, "Mix", p, 0, overrides)
                            if abs(mix - want) > EPS:
                                problems.add(f"{name}.Mix = {mix:.3f} at progress {p}, expected {want} [{tag}]")
                    after = model.chain[: next((i for i, n in enumerate(model.chain)
                                                if model.tools[n].regid == "Dissolve"), 0)]
                    saved, model.chain = model.chain, after
                    for problem in _neutral_problems(model, p, 0, overrides):
                        problems.add(f"transition not clean at progress {p}: {problem} [{tag}]")
                    model.chain = saved
        except ArithmeticError as err:
            problems.add(f"cannot evaluate the start/end checks ({err}) [{tag}]")
    return sorted(problems), count
