"""The parts every template shares: the progress driver and the control holder.

Progress
    One Anim Curves modifier (registry ID LUTLookup) per template outputs a
    0..1 ramp. `Source = Duration` makes it span the clip the effect sits on;
    `Source = Transition` makes it span a transition. Trimming on the Edit
    page retimes it, so no template contains a keyframe.

Control holder
    A Custom tool that is never wired into the picture holds the ramp in
    NumberIn1 and the editor-facing sliders in NumberIn2..8. Every animated
    input is an expression that reads those numbers, so one definition of
    "progress" and one set of controls drives the whole node graph.
"""

from __future__ import annotations

from .graph import Expr, Fu, Link, Macro
from .luatable import T, Table

MAX_SLOTS = 8

# Envelope options, in dropdown order. The index is what expressions compare.
ENVELOPES = ["Hit (fade out)", "Build (fade in)", "Pulse (peak mid-clip)", "Constant"]
HIT, BUILD, PULSE, CONSTANT = range(4)


def _linear_lookup() -> dict:
    # A straight 0..1 line, written the way Resolve saves an untouched
    # Anim Curves lookup (handles at one third of the segment).
    third, two_thirds = 0.333333333333333, 0.666666666666667
    keys = Table()
    keys.items.append((0, T(None, 0, RH=T(None, third, third), Flags=T(None, Linear=True))))
    keys.items.append((1, T(None, 1, LH=T(None, two_thirds, two_thirds), Flags=T(None, Linear=True))))
    channels = Table()
    channels.items.append((0, keys))
    return {
        "KeyColorSplines": channels,
        "SplineColor": T(None, Red=255, Green=255, Blue=255),
    }


class Rig:
    def __init__(self, macro: Macro, source: str, ease_in: str = "Sine", ease_out: str = "Sine"):
        self.m = macro
        self.user_controls = Table(ctor="ordered")
        self.ctl = macro.add("Custom", "Ctl", attrs={"UserControls": self.user_controls})
        lookup = macro.add("LUTBezier", "ProgressLookup", attrs=_linear_lookup(), modifier=True)
        self.progress = macro.add(
            "LUTLookup",
            "Progress",
            {
                "Source": Fu(source),
                "Curve": Fu("Easing"),
                "EaseIn": Fu(ease_in),
                "EaseOut": Fu(ease_out),
                "Lookup": Link(lookup, "Value"),
            },
            modifier=True,
        )
        ctl = macro.tool(self.ctl)
        ctl.inputs["NumberIn1"] = Link(self.progress, "Value")
        ctl.inputs["NameforNumber1"] = "Progress"
        self.slots = 1
        self.P = f"{self.ctl}.NumberIn1"

    def _slot(self, label: str, default: float) -> str:
        self.slots += 1
        if self.slots > MAX_SLOTS:
            raise ValueError(f"{self.m.ident}: more than {MAX_SLOTS - 1} controls on one holder")
        ctl = self.m.tool(self.ctl)
        ctl.inputs[f"NumberIn{self.slots}"] = default
        ctl.inputs[f"NameforNumber{self.slots}"] = label
        return f"NumberIn{self.slots}"

    def slider(self, label: str, default: float, lo: float, hi: float, doc: str = "") -> str:
        """Add a slider; returns the expression text that reads it."""
        input_id = self._slot(label, default)
        self.m.publish(self.ctl, input_id, label, doc=doc, Default=default, MinScale=lo, MaxScale=hi)
        return f"{self.ctl}.{input_id}"

    def combo(self, label: str, options: list[str], default: int = 0, doc: str = "") -> str:
        """Add a dropdown; the expression value is the 0-based option index."""
        input_id = self._slot(label, default)
        control = Table()
        for option in options:
            control.items.append((None, T(None, CCS_AddString=option)))
        last = len(options) - 1
        control.items += [
            ("LINKS_Name", label),
            ("LINKID_DataType", "Number"),
            ("INPID_InputControl", "ComboControl"),
            ("CC_LabelPosition", "Horizontal"),
            ("INP_Integer", False),
            ("INP_Default", default),
            ("INP_MinScale", 0),
            ("INP_MaxScale", last),
            ("INP_MinAllowed", 0),
            ("INP_MaxAllowed", last),
            ("ICS_ControlPage", "Controls"),
        ]
        self.user_controls.items.append((input_id, control))
        listed = ", ".join(options)
        self.m.publish(self.ctl, input_id, label, doc=f"{doc} Options: {listed}.".strip(), Default=default)
        return f"{self.ctl}.{input_id}"

    def envelope(self, default: int, doc: str = "") -> str:
        """Add the shared Envelope dropdown; returns a 0..1 strength expression."""
        mode = self.combo(
            "Envelope", ENVELOPES, default,
            doc=doc or "How strength changes over the clip.",
        )
        self.mode = mode
        p = self.P
        return (
            f"iif({mode} == {HIT}, 1 - {p}, iif({mode} == {BUILD}, {p}, "
            f"iif({mode} == {PULSE}, 4*{p}*(1 - {p}), 1)))"
        )

    def bell(self) -> str:
        """0 at both ends of the clip, 1 in the middle."""
        return f"(4*{self.P}*(1 - {self.P}))"

    def publish_ease(self) -> None:
        self.m.publish(self.progress, "Curve", "Curve",
                       doc="Easing uses the two menus below; Custom opens a curve editor.")
        self.m.publish(self.progress, "EaseIn", "Ease In", doc="Acceleration at the start.")
        self.m.publish(self.progress, "EaseOut", "Ease Out", doc="Deceleration at the end.")


def rnd(seed: str) -> str:
    """Repeatable pseudo-random 0..1 from a number (noise() is unavailable)."""
    return f"((sin(({seed})*12.9898)*43758.5453) % 1)"


def clamp01(expr: str) -> str:
    return f"min(1, max(0, {expr}))"


def E(text: str) -> Expr:
    return Expr(" ".join(text.split()))
