"""Builds one Edit-page template (a Fusion macro) and serialises it.

A definition calls `Macro.add(...)` for each node, `publish(...)` for each
control the editor should see, and names the image input(s) and output. The
shape of the emitted file follows the templates Resolve ships: a GroupOperator
with InstanceInput / InstanceOutput entries wrapping an ordered Tools table.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .luatable import Table, T, dumps

EFFECT = "Effects"
TRANSITION = "Transitions"


class Fu(str):
    """A FuID option value, e.g. Fu("Sine")."""


@dataclass
class Expr:
    """A SimpleExpression. `time` is frames, trig is radians."""

    text: str


@dataclass
class Link:
    """A wire from another tool's output."""

    tool: str
    output: str = "Output"


def _input(value: Any) -> Table:
    if isinstance(value, Expr):
        return T("Input", Expression=value.text)
    if isinstance(value, Link):
        return T("Input", SourceOp=value.tool, Source=value.output)
    if isinstance(value, Fu):
        return T("Input", Value=T("FuID", str(value)))
    if isinstance(value, tuple):
        return T("Input", Value=T(None, *value))
    if isinstance(value, (int, float, str, Table)):
        return T("Input", Value=value)
    raise TypeError(f"unsupported input value {value!r}")


@dataclass
class Tool:
    name: str
    regid: str
    inputs: dict[str, Any]
    attrs: dict[str, Any] = field(default_factory=dict)
    modifier: bool = False
    pos: tuple[float, float] = (0, 0)

    def table(self) -> Table:
        t = Table(ctor=self.regid)
        if not self.modifier:
            t.items.append(("CtrlWZoom", False))
        for key, value in self.attrs.items():
            t.items.append((key, value))
        if self.inputs:
            inputs = Table()
            for key, value in self.inputs.items():
                inputs.items.append((key, _input(value)))
            t.items.append(("Inputs", inputs))
        if not self.modifier:
            t.items.append(("ViewInfo", T("OperatorInfo", Pos=T(None, *self.pos))))
        return t


class Macro:
    def __init__(self, ident: str, title: str, category: str, folder: str, summary: str = ""):
        self.ident = ident  # node name of the group: the template's identity
        self.title = title  # file name: what the Effects Library shows
        self.category = category  # EFFECT or TRANSITION
        self.folder = folder  # sub-bin inside the category
        self.summary = summary
        self.kind = "effect"  # "effect", "cut" (adjustment-clip transition) or "transition"
        self.tools: list[Tool] = []
        self.main_inputs: list[tuple[str, str]] = []
        self.published: list[Table] = []
        self.controls: list[dict] = []  # for the README and the test checklist
        self.apply = ""  # test checklist: what to drop it on
        self.expect = ""  # test checklist: what you should see
        self.tryout = ""  # test checklist: which controls to try
        self.output: tuple[str, str] | None = None

    # -- nodes ---------------------------------------------------------------
    def add(self, regid: str, short: str, inputs: dict[str, Any] | None = None, *,
            attrs: dict[str, Any] | None = None, modifier: bool = False) -> str:
        name = f"{self.ident}_{short}"
        if any(t.name.lower() == name.lower() for t in self.tools):
            raise ValueError(f"{self.ident}: duplicate tool name {name}")
        placed = sum(1 for t in self.tools if not t.modifier)
        tool = Tool(name, regid, dict(inputs or {}), dict(attrs or {}), modifier, (placed * 110, 0))
        self.tools.append(tool)
        return name

    def tool(self, name: str) -> Tool:
        return next(t for t in self.tools if t.name == name)

    # -- interface -----------------------------------------------------------
    def main_input(self, tool: str, input_id: str) -> None:
        self.main_inputs.append((tool, input_id))

    def main_output(self, tool: str, output: str = "Output") -> None:
        self.output = (tool, output)

    def publish(self, tool: str, input_id: str, label: str | None, *, doc: str = "", **opts: Any) -> None:
        """Expose an inner input in the Edit page Inspector.

        The input is written into the inner tool explicitly, so a published
        control never points at something that is only an assumed default.
        """
        target = self.tool(tool)
        if input_id not in target.inputs:
            raise ValueError(f"{self.ident}: publishing {tool}.{input_id} which is not set on the tool")
        entry = T("InstanceInput", SourceOp=tool, Source=input_id)
        if label:  # members of a colour group after the first carry no name
            entry.items.append(("Name", label))
            self.controls.append({"label": label, "doc": doc})
        for key, value in opts.items():
            entry.items.append((key, value))
        self.published.append(entry)

    # -- output --------------------------------------------------------------
    def table(self) -> Table:
        if self.output is None:
            raise ValueError(f"{self.ident}: no output set")
        inputs = Table(ctor="ordered")
        for i, (tool, input_id) in enumerate(self.main_inputs, 1):
            inputs.items.append((f"MainInput{i}", T("InstanceInput", SourceOp=tool, Source=input_id)))
        for i, entry in enumerate(self.published, 1):
            inputs.items.append((f"Input{i}", entry))
        inner = Table(ctor="ordered")
        for tool in self.tools:
            inner.items.append((tool.name, tool.table()))
        group = Table(ctor="GroupOperator")
        group.items += [
            ("CtrlWZoom", False),
            ("Inputs", inputs),
            ("Outputs", T(None, MainOutput1=T("InstanceOutput", SourceOp=self.output[0], Source=self.output[1]))),
            ("ViewInfo", T("GroupInfo", Pos=T(None, 0, 0))),
            ("Tools", inner),
        ]
        tools = Table(ctor="ordered")
        tools.items.append((self.ident, group))
        return T(None, Tools=tools, ActiveTool=self.ident)

    def text(self) -> str:
        return dumps(self.table()) + "\n"

    @property
    def relpath(self) -> str:
        return f"Edit/{self.category}/{self.folder}/{self.title}.setting"
