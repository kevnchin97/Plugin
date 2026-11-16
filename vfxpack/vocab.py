"""The only Fusion tool IDs, input IDs and option values this pack may emit.

Nothing here is guessed. Every entry was seen in one of these sources, and the
validator refuses any tool, input or option that is not listed:

  [R]  Reactor corpus: 613 real exported .setting files from the public
       WeSuckLess Reactor repository (gitlab.com/WeSuckLess/Reactor), parsed
       with vfxpack.luatable and counted.
  [S]  "setting-format" reference from the open-fusion-mcp project (MIT),
       mined by its authors from the 417 templates shipped inside Resolve
       Studio 21.1 and checked against that version's live tool registry.
  [M]  Fusion 21.1 reference manual (menu order of option lists).

Enum numbers marked "menu order" are the position of the option in the manual's
menu list. The numbers themselves were seen in real files ([R]), but which
option each number selects is an inference until checked in Resolve. They are
listed in docs/EVIDENCE.md and called out in TESTING.md.

Types: N number, P point, F FuID string, T text, I image connection,
       L lookup-curve connection.
"""

from __future__ import annotations

EASES = ["Sine", "Quad", "Cubic", "Quart", "Quint", "Expo", "Circ", "Back", "Elastic", "Bounce"]

MERGE_APPLY_MODES = [
    "Screen", "Overlay", "Multiply", "Difference", "Soft Light", "Color Dodge",
    "Color Burn", "LinearBurn", "LinearLight", "Lighten", "Color", "Hypotenuse",
    "DarkerColor", "LighterColor",
]

# Inputs every image-processing tool has (Common Controls tab). [R] on
# Transform, BrightnessContrast, DirectionalBlur, ChannelBoolean; [M] p.1628.
COMMON = {
    "Blend": "N",
    "EffectMask": "I",
    "ProcessRed": "N",
    "ProcessGreen": "N",
    "ProcessBlue": "N",
    "ProcessAlpha": "N",
    "ApplyMaskInverted": "N",
    "MultiplyByMask": "N",
}

# Size inputs every image generator has. [S] gotcha 12 and 31: without
# UseFrameFormatSettings = 1 a pasted generator renders at 320x240.
GENERATOR = {
    "Width": "N",
    "Height": "N",
    "UseFrameFormatSettings": "N",
    "GlobalIn": "N",
    "GlobalOut": "N",
}

TOOLS: dict[str, dict] = {
    # ---- containers -------------------------------------------------------
    "GroupOperator": {"kind": "group"},  # [S] 394 uses; Blackmagic's own templates
    "MacroOperator": {"kind": "group"},  # [S] 83 uses; [R]
    # ---- image tools ------------------------------------------------------
    "Transform": {  # [R] n=990, [S] n=491
        "kind": "image",
        "common": True,
        "image_inputs": ["Input"],
        "outputs": ["Output"],
        "inputs": {
            "Input": "I",
            "Center": "P",
            "Pivot": "P",
            "Size": "N",
            "Angle": "N",
            # [R] values 1 x80, 3 x17, 2 x3. Menu order [M]: Canvas, Wrap,
            # Duplicate, Mirror -> 0, 1, 2, 3.
            "Edges": "N",
            "MotionBlur": "N",  # [R] [S]
            "Quality": "N",  # [R] [S] (8)
            "ShutterAngle": "N",  # [R] [S] (180/360)
        },
        "enums": {"Edges": [0, 1, 2, 3]},
    },
    "DirectionalBlur": {  # [R] n=16, [S] n=15
        "kind": "image",
        "common": True,
        "image_inputs": ["Input"],
        "outputs": ["Output"],
        "inputs": {
            "Input": "I",
            # [R] values 3 x8, 2 x6, 1 x1. Menu order [M]: Linear, Radial,
            # Centered, Zoom -> 0, 1, 2, 3.
            "Type": "N",
            "Length": "N",
            "Angle": "N",
            "Center": "P",
            "Glow": "N",
        },
        "enums": {"Type": [0, 1, 2, 3]},
    },
    "BrightnessContrast": {  # [R] n=266, [S] n=142
        "kind": "image",
        "common": True,
        "image_inputs": ["Input"],
        "outputs": ["Output"],
        "inputs": {
            "Input": "I",
            "Gain": "N",
            "Lift": "N",
            "Gamma": "N",
            "Contrast": "N",
            "Brightness": "N",
            "Saturation": "N",
            "ClipBlack": "N",
            "ClipWhite": "N",
        },
    },
    "Merge": {  # [S] n=510
        "kind": "image",
        "common": True,
        "image_inputs": ["Background", "Foreground"],
        "outputs": ["Output"],
        "inputs": {
            "Background": "I",
            "Foreground": "I",
            "Center": "P",
            "Size": "N",
            "Angle": "N",
            "ApplyMode": "F",
            "PerformDepthMerge": "N",
        },
        "options": {"ApplyMode": MERGE_APPLY_MODES},
    },
    "Dissolve": {  # [S] n=172, [R] n=138
        "kind": "image",
        "common": True,
        "image_inputs": ["Background", "Foreground", "Map"],
        "outputs": ["Output"],
        "inputs": {
            "Background": "I",
            "Foreground": "I",
            "Map": "I",
            "Mix": "N",
            "Operation": "F",
            "DFTLumaRamp.Softness": "N",
        },
        "options": {"Operation": ["DFTLumaRamp", "DFTWipe", "DFTAlphaMerge"]},
        "attrs": ["Transitions"],
    },
    "Displace": {  # [R] n=30, [S] n=37
        "kind": "image",
        "common": True,
        "image_inputs": ["Input", "Foreground"],
        "outputs": ["Output"],
        "inputs": {
            "Input": "I",
            "Foreground": "I",  # the displacement map; [S] live: not "Background"
            "Type": "N",  # [R] always 1. Menu order [M]: Radial, X/Y -> 0, 1
            "XRefraction": "N",
            "YRefraction": "N",
            # [R] always 4. Menu order [M]: Red, Green, Blue, Alpha,
            # Luminance -> 0..4
            "XChannel": "N",
            "YChannel": "N",
            "XOffset": "N",
            "YOffset": "N",
        },
        "enums": {"Type": [1], "XChannel": [4], "YChannel": [4]},
    },
    "Background": {  # [R] n=455, [S] n=435
        "kind": "image",
        "common": True,
        "generator": True,
        "image_inputs": [],
        "outputs": ["Output"],
        "inputs": {
            "Type": "F",
            "TopLeftRed": "N",
            "TopLeftGreen": "N",
            "TopLeftBlue": "N",
            "TopLeftAlpha": "N",
            "Gradient": "G",
            "Start": "P",
            "End": "P",
        },
        "options": {"Type": ["Gradient", "Vertical", "Horizontal", "Corner"]},
    },
    "FastNoise": {  # [R] n=52, [S] n=120
        "kind": "image",
        "common": True,
        "generator": True,
        "image_inputs": [],
        "outputs": ["Output"],
        "inputs": {
            "Detail": "N",
            "Contrast": "N",
            "Brightness": "N",
            "XScale": "N",
            "YScale": "N",
            "LockXY": "N",
            "Seethe": "N",
            "SeetheRate": "N",
            "Discontinuous": "N",
            "Color1Alpha": "N",
            "Center": "P",
        },
    },
    # Never wired into the picture here: used only as a holder for sliders
    # that expressions read as <Tool>.NumberIn<n>. [S] live: "Ctrl_Main.NumberIn1".
    "Custom": {  # [R] n=269
        "kind": "image",
        "common": True,
        "image_inputs": ["Image1"],
        "outputs": ["Output"],
        "inputs": {
            **{f"NumberIn{i}": "N" for i in range(1, 9)},
            **{f"NameforNumber{i}": "T" for i in range(1, 9)},
        },
        "attrs": ["UserControls"],
    },
    # ---- modifiers --------------------------------------------------------
    "LUTLookup": {  # "Anim Curves". [S] n=472, 405 of them in Edit templates
        "kind": "modifier",
        "outputs": ["Value"],
        "inputs": {
            "Source": "F",
            "Curve": "F",
            "EaseIn": "F",
            "EaseOut": "F",
            "Lookup": "L",
            "Scale": "N",
            "Offset": "N",
            "Invert": "N",
            "Mirror": "N",
            "TimeScale": "N",
            "TimeOffset": "N",
        },
        "options": {
            "Source": ["Duration", "Transition", "Custom"],
            "Curve": ["Easing", "Custom"],
            "EaseIn": EASES,
            "EaseOut": EASES,
        },
    },
    "LUTBezier": {  # [S]
        "kind": "modifier",
        "outputs": ["Value"],
        "inputs": {},
        "attrs": ["KeyColorSplines", "SplineColor"],
    },
}

# Tool-level keys that are UI state or structure rather than inputs. [S] 1.3
TOOL_KEYS = {
    "Inputs", "ViewInfo", "CtrlWZoom", "CtrlWShown", "NameSet", "Outputs", "Tools",
}

# InstanceInput keys seen in shipped templates. [S] 1.10
INSTANCE_INPUT_KEYS = {
    "SourceOp", "Source", "Name", "Default", "MinScale", "MaxScale", "ControlGroup",
    "Page", "Width", "DefaultX", "DefaultY",
}

# UserControls keys used to turn a Custom NumberIn slider into a dropdown.
# Copied key-for-key from a real ComboControl ([R] ml_stMap.setting) and
# CheckboxControl ([R] ml_AddMix.setting, on a Custom tool's NumberIn1).
USER_CONTROL_KEYS = {
    "LINKS_Name", "LINKID_DataType", "INPID_InputControl", "INP_Default", "INP_Integer",
    "INP_MinScale", "INP_MaxScale", "INP_MinAllowed", "INP_MaxAllowed", "ICS_ControlPage",
    "CC_LabelPosition", "CBC_TriState",
}
USER_CONTROL_TYPES = {"ComboControl", "CheckboxControl"}

# Functions and names allowed inside expressions. [S] realities section 7
# (live on 21.1) and [R] (bare sin/abs/floor in shipped expressions).
# noise() is deliberately absent: it makes the input evaluate to nil.
EXPRESSION_FUNCTIONS = {"iif", "Point", "sin", "cos", "abs", "floor", "min", "max"}
EXPRESSION_NAMES = {"time", "pi"}


def tool_inputs(regid: str) -> dict[str, str]:
    spec = TOOLS[regid]
    inputs = dict(spec.get("inputs", {}))
    if spec.get("common"):
        inputs.update(COMMON)
    if spec.get("generator"):
        inputs.update(GENERATOR)
    return inputs
