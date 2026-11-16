"""Static checks on a generated (or hand-edited, or Resolve-exported) template.

Resolve gives no error for most template mistakes: the template is missing
from the Effects Library, or a slider moves and nothing happens. These checks
catch the causes that can be found without running Resolve.

`validate_text` returns a list of problems; an empty list means every check
passed. It never means the effect looks right: only Resolve can show that.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass

from . import vocab
from .luatable import LuaSyntaxError, Table, parse

GROUPS = {"GroupOperator", "MacroOperator"}
REF = re.compile(r"\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b")
WORD = re.compile(r"(?<![\w.])([A-Za-z_]\w*)\b(?!\s*\.)")


@dataclass
class ToolInfo:
    name: str
    regid: str
    table: Table
    inputs: Table


def _collect(group: Table) -> list[ToolInfo]:
    tools = group.get("Tools")
    found: list[ToolInfo] = []
    if isinstance(tools, Table):
        for name, table in tools.keyed():
            if isinstance(table, Table) and table.ctor:
                inputs = table.get("Inputs")
                found.append(ToolInfo(name, table.ctor, table, inputs if isinstance(inputs, Table) else Table()))
    return found


def _check_expression(text: str, where: str, tools: dict[str, ToolInfo], problems: list[str]) -> None:
    depth = 0
    for ch in text:
        depth += ch == "("
        depth -= ch == ")"
        if depth < 0:
            break
    if depth != 0:
        problems.append(f"{where}: unbalanced parentheses in expression")
    if "\n" in text:
        problems.append(f"{where}: expression contains a line break")
    for tool_name, input_id in REF.findall(text):
        target = tools.get(tool_name.lower())
        if target is None:
            problems.append(f"{where}: expression reads {tool_name}.{input_id} but no tool is named {tool_name}")
        elif input_id not in target.inputs:
            problems.append(f"{where}: expression reads {tool_name}.{input_id} which is not set on that tool")
    stripped = REF.sub("0", text)
    for word in WORD.findall(stripped):
        if word not in vocab.EXPRESSION_FUNCTIONS and word not in vocab.EXPRESSION_NAMES:
            problems.append(f"{where}: expression uses {word!r}, which is not on the allowed list")


def _check_value(info: ToolInfo, input_id: str, kind: str, entry: Table, problems: list[str]) -> None:
    where = f"{info.name}.{input_id}"
    spec = vocab.TOOLS[info.regid]
    value = entry.get("Value")
    if "Value" not in entry:
        return
    if kind == "N":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            problems.append(f"{where}: expects a number, got {value!r}")
        elif input_id in spec.get("enums", {}) and value not in spec["enums"][input_id]:
            problems.append(f"{where}: value {value} is not a confirmed option {spec['enums'][input_id]}")
    elif kind == "F":
        if not (isinstance(value, Table) and value.ctor == "FuID" and len(value.positional()) == 1):
            problems.append(f"{where}: expects FuID {{ \"...\" }} (a bare string or number is silently ignored)")
        else:
            option = value.positional()[0]
            allowed = spec.get("options", {}).get(input_id)
            if allowed is not None and option not in allowed:
                problems.append(f"{where}: option {option!r} is not a confirmed value {allowed}")
    elif kind == "P":
        if not (isinstance(value, Table) and len(value.positional()) == 2):
            problems.append(f"{where}: expects a point {{ x, y }}")
    elif kind == "T":
        if not isinstance(value, str):
            problems.append(f"{where}: expects text")
    elif kind in ("I", "L"):
        problems.append(f"{where}: is a connection and cannot hold a value")


def validate_text(text: str, category: str | None = None) -> list[str]:
    """Check one .setting file. `category` is "Effects" or "Transitions"."""
    try:
        root = parse(text)
    except LuaSyntaxError as err:
        return [f"syntax: {err}"]
    problems: list[str] = []

    top = root.get("Tools")
    if not isinstance(top, Table) or top.ctor != "ordered":
        return ["top level: expected Tools = ordered() { ... }"]
    entries = [(k, v) for k, v in top.keyed() if isinstance(v, Table)]
    groups = [(k, v) for k, v in entries if v.ctor in GROUPS]
    if len(groups) != 1 or len(entries) != 1:
        return [f"top level: expected exactly one group/macro, found {[v.ctor for _, v in entries]}"]
    ident, group = groups[0]
    active = root.get("ActiveTool")
    if active is not None and active != ident:
        problems.append(f"ActiveTool is {active!r} but the group is named {ident!r}")

    infos = _collect(group)
    tools: dict[str, ToolInfo] = {}
    for info in infos:
        key = info.name.lower()  # Fusion treats tool names as case-insensitive
        if key in tools or key == ident.lower():
            problems.append(f"{info.name}: tool name is used twice (names ignore case)")
        tools[key] = info

    # every table: no key written twice
    def walk(table: Table, path: str) -> None:
        for dupe in table.duplicate_keys():
            problems.append(f"{path}: key {dupe!r} appears twice")
        for key, value in table.items:
            if isinstance(value, Table):
                walk(value, f"{path}.{key}" if key is not None else path)
    walk(root, "file")

    # tools, inputs, values, wires
    for info in infos:
        spec = vocab.TOOLS.get(info.regid)
        if spec is None:
            problems.append(f"{info.name}: tool type {info.regid!r} is not in the confirmed vocabulary")
            continue
        allowed_keys = vocab.TOOL_KEYS | set(spec.get("attrs", []))
        for key, _ in info.table.keyed():
            if key not in allowed_keys:
                problems.append(f"{info.name}: tool-level key {key!r} is not confirmed for {info.regid}")
        known = vocab.tool_inputs(info.regid)
        for input_id, entry in info.inputs.keyed():
            where = f"{info.name}.{input_id}"
            if input_id not in known:
                problems.append(f"{where}: {info.regid} has no confirmed input {input_id!r}")
                continue
            if not (isinstance(entry, Table) and entry.ctor == "Input"):
                problems.append(f"{where}: must be written as Input {{ ... }}")
                continue
            source = entry.get("SourceOp")
            if source is not None:
                target = tools.get(str(source).lower())
                if target is None:
                    problems.append(f"{where}: wired to {source!r}, which is not in the file")
                else:
                    outputs = vocab.TOOLS.get(target.regid, {}).get("outputs", [])
                    if entry.get("Source") not in outputs:
                        problems.append(f"{where}: {target.regid} has no output {entry.get('Source')!r} (has {outputs})")
                    wants_curve = known[input_id] == "L"
                    if wants_curve != (target.regid == "LUTBezier"):
                        problems.append(f"{where}: wired to the wrong kind of tool ({target.regid})")
            expression = entry.get("Expression")
            if expression is not None:
                _check_expression(str(expression), where, tools, problems)
            _check_value(info, input_id, known[input_id], entry, problems)
        if spec.get("generator"):
            flag = info.inputs.get("UseFrameFormatSettings")
            if not (isinstance(flag, Table) and flag.get("Value") == 1):
                problems.append(f"{info.name}: generator without UseFrameFormatSettings = 1 renders at 320x240")
        if spec["kind"] == "image" and "ViewInfo" not in info.table:
            problems.append(f"{info.name}: image tool has no ViewInfo")
        controls = info.table.get("UserControls")
        if isinstance(controls, Table):
            for control_id, control in controls.keyed():
                where = f"{info.name}.UserControls.{control_id}"
                if control_id not in known:
                    problems.append(f"{where}: overrides an input the tool does not have")
                if not isinstance(control, Table):
                    problems.append(f"{where}: must be a table")
                    continue
                if control.get("INPID_InputControl") not in vocab.USER_CONTROL_TYPES:
                    problems.append(f"{where}: control type {control.get('INPID_InputControl')!r} is not confirmed")
                for key, _ in control.keyed():
                    if key not in vocab.USER_CONTROL_KEYS:
                        problems.append(f"{where}: key {key!r} is not confirmed")
                options = control.positional()
                for option in options:
                    if not (isinstance(option, Table) and isinstance(option.get("CCS_AddString"), str)):
                        problems.append(f"{where}: options must be {{ CCS_AddString = \"...\" }}")
                if control.get("INPID_InputControl") == "ComboControl":
                    if len(options) < 2:
                        problems.append(f"{where}: dropdown needs at least two options")
                    if control.get("INP_MaxAllowed") != len(options) - 1:
                        problems.append(f"{where}: INP_MaxAllowed does not match the number of options")

    # interface
    inputs = group.get("Inputs")
    if not isinstance(inputs, Table) or inputs.ctor != "ordered":
        problems.append("group: Inputs must be ordered() { ... }")
        inputs = Table()
    mains = []
    for key, entry in inputs.keyed():
        where = f"published {key}"
        if not (isinstance(entry, Table) and entry.ctor == "InstanceInput"):
            problems.append(f"{where}: must be an InstanceInput")
            continue
        for k, _ in entry.keyed():
            if k not in vocab.INSTANCE_INPUT_KEYS:
                problems.append(f"{where}: key {k!r} is not confirmed on InstanceInput")
        target = tools.get(str(entry.get("SourceOp")).lower())
        if target is None:
            problems.append(f"{where}: points at tool {entry.get('SourceOp')!r}, which is not in the file")
            continue
        source = entry.get("Source")
        known = vocab.tool_inputs(target.regid) if target.regid in vocab.TOOLS else {}
        if source not in known:
            problems.append(f"{where}: {target.regid} has no confirmed input {source!r}")
            continue
        if str(key).startswith("MainInput"):
            mains.append(key)
            if known[source] != "I":
                problems.append(f"{where}: {target.name}.{source} is not an image input")
            if source in target.inputs:
                problems.append(f"{where}: {target.name}.{source} is already wired inside the macro")
        else:
            if source not in target.inputs:
                problems.append(f"{where}: {target.name}.{source} is not written in the file")
            if not isinstance(entry.get("Name"), str) and entry.get("ControlGroup") is None:
                problems.append(f"{where}: control has no Name")
    wanted = {"Effects": ["MainInput1"], "Transitions": ["MainInput1", "MainInput2"]}.get(category or "")
    if wanted is not None and mains != wanted:
        problems.append(f"group: {category} template needs image inputs {wanted}, found {mains}")

    outputs = group.get("Outputs")
    main_out = outputs.get("MainOutput1") if isinstance(outputs, Table) else None
    if not (isinstance(main_out, Table) and main_out.ctor == "InstanceOutput"):
        problems.append("group: missing Outputs.MainOutput1 = InstanceOutput { ... }")
    else:
        target = tools.get(str(main_out.get("SourceOp")).lower())
        if target is None:
            problems.append(f"MainOutput1: points at {main_out.get('SourceOp')!r}, which is not in the file")
        elif main_out.get("Source") not in vocab.TOOLS.get(target.regid, {}).get("outputs", []):
            problems.append(f"MainOutput1: {target.regid} has no output {main_out.get('Source')!r}")
        elif vocab.TOOLS[target.regid]["kind"] != "image":
            problems.append("MainOutput1: must come from an image tool")

    # timing: one Anim Curves per template, spanning the right thing
    drivers = [i for i in infos if i.regid == "LUTLookup"]
    if not drivers:
        problems.append("timing: no Anim Curves (LUTLookup) modifier, so nothing follows the clip length")
    for info in drivers:
        source = info.inputs.get("Source")
        value = source.get("Value") if isinstance(source, Table) else None
        option = value.positional()[0] if isinstance(value, Table) and value.positional() else None
        expected = {"Effects": "Duration", "Transitions": "Transition"}.get(category or "")
        if expected and option != expected:
            problems.append(f"{info.name}: Source is {option!r}; a template in {category} needs {expected!r}")
        if not any(
            isinstance(e, Table) and str(e.get("SourceOp", "")).lower() == info.name.lower()
            for other in infos for _, e in other.inputs.keyed()
        ):
            problems.append(f"{info.name}: Anim Curves modifier is not connected to anything")

    # every image tool must reach the output
    if isinstance(main_out, Table):
        reached: set[str] = set()
        stack = [str(main_out.get("SourceOp")).lower()]
        while stack:
            name = stack.pop()
            if name in reached or name not in tools:
                continue
            reached.add(name)
            for _, entry in tools[name].inputs.keyed():
                if isinstance(entry, Table):
                    if entry.get("SourceOp"):
                        stack.append(str(entry.get("SourceOp")).lower())
                    for ref_tool, _ in REF.findall(str(entry.get("Expression") or "")):
                        stack.append(ref_tool.lower())
        for info in infos:
            if info.name.lower() not in reached:
                problems.append(f"{info.name}: is not connected to the output, directly or by expression")
        for key, entry in inputs.keyed():
            if isinstance(entry, Table) and str(entry.get("SourceOp")).lower() not in reached:
                problems.append(f"published {key}: controls a tool that does not reach the output")
    return problems


def validate_bundle(path: str) -> list[str]:
    """Check a .drfx: a zip whose top folder is Edit/, holding only templates."""
    problems: list[str] = []
    with zipfile.ZipFile(path) as bundle:
        if bundle.testzip() is not None:
            problems.append("bundle: zip is corrupt")
        names = [n for n in bundle.namelist() if not n.endswith("/")]
        if not names:
            problems.append("bundle: empty")
        seen: set[str] = set()
        for name in names:
            parts = name.split("/")
            if "\\" in name:
                problems.append(f"bundle: {name!r} uses backslashes")
            if len(parts) < 4 or parts[0] != "Edit" or parts[1] not in ("Effects", "Transitions", "Titles", "Generators"):
                problems.append(f"bundle: {name!r} is not under Edit/<Effects|Transitions|Titles|Generators>/<folder>/")
                continue
            if not name.endswith((".setting", ".png")):
                problems.append(f"bundle: {name!r} is not a template or an icon")
            if name.lower() in seen:
                problems.append(f"bundle: {name!r} is duplicated")
            seen.add(name.lower())
            if name.endswith(".setting"):
                text = bundle.read(name).decode("utf-8")
                problems += [f"{name}: {p}" for p in validate_text(text, parts[1])]
    return problems
