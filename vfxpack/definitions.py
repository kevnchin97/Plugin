"""The effects. One function per template; each returns a finished Macro.

To add an effect, write a function here, add it to ALL at the bottom and run
`python build.py`. Use only tools and inputs listed in vocab.py: the build
fails on anything else.
"""

from __future__ import annotations

from .graph import EFFECT, TRANSITION, Fu, Link, Macro
from .luatable import T, Table
from .rig import BUILD, CONSTANT, HIT, E, Rig, clamp01, rnd

FX = "Pulse FX"
CUTS = "Pulse FX Cuts"

MIRROR = 3  # Transform Edges
BLUR_CENTERED, BLUR_ZOOM = 2, 3  # DirectionalBlur Type
Y_ASPECT = 1.78  # centre offsets are per-axis fractions; this evens out x and y in pixels

ON_CLIP = "Drag onto a video clip (or an adjustment clip above several clips)."
ON_CUT = ("Put an adjustment clip on the track above a cut, centred on the cut and about "
          "12-20 frames long, then drag the effect onto the adjustment clip.")
ON_EDIT_POINT = "Drag onto the cut between two clips that have handles, like any transition."


def camera_shake() -> Macro:
    m = Macro("PFXCameraShake", "PFX Camera Shake", EFFECT, FX,
              "Handheld jitter up to a violent impact shake, with rotation.")
    r = Rig(m, "Duration")
    strength = r.slider("Strength", 0.35, 0, 1, "How far the frame moves.")
    speed = r.slider("Speed", 1, 0.1, 4, "How fast it shakes.")
    rotation = r.slider("Rotation", 0.3, 0, 1, "How much the frame tilts.")
    env = r.envelope(CONSTANT, "Constant shakes for the whole clip; Hit is an impact that settles.")
    amp = f"({strength}*0.04*({env}))"
    w = f"(time*{speed}*1.1)"
    nx = f"(sin({w} + 1.3) + 0.6*sin({w}*2.31 + 4.1) + 0.3*sin({w}*4.73 + 0.7))/1.9"
    ny = f"(sin({w}*1.13 + 5.2) + 0.6*sin({w}*2.57 + 2.2) + 0.3*sin({w}*5.11 + 3.9))/1.9"
    nr = f"(sin({w}*0.83 + 2.6) + 0.5*sin({w}*1.91 + 0.4))/1.5"
    xf = m.add("Transform", "Xf", {
        "Center": E(f"Point(0.5 + {amp}*{nx}, 0.5 + {amp}*{Y_ASPECT}*{ny})"),
        "Angle": E(f"{rotation}*4*({env})*{strength}*{nr}"),
        "Size": E(f"1 + 4*{amp}"),  # zoom in just enough to keep the edges out of frame
        "Edges": MIRROR,
        "MotionBlur": 0,
        "Quality": 4,
    })
    m.publish(xf, "MotionBlur", "Motion Blur", doc="Smears the shake. Slower to render.", Default=0)
    r.publish_ease()
    m.main_input(xf, "Input")
    m.main_output(xf)
    m.apply = ON_CLIP
    m.expect = "The picture shakes for the whole clip, slightly zoomed in so no edges show."
    m.tryout = "Strength to 1; Envelope to Hit (shake dies away); Motion Blur on."
    return m


def zoom_punch() -> Macro:
    m = Macro("PFXZoomPunch", "PFX Zoom Punch", EFFECT, FX,
              "A beat-hit punch-in that settles back, or a push-in that builds.")
    r = Rig(m, "Duration", "Sine", "Expo")
    amount = r.slider("Amount", 0.25, 0, 1, "How far it zooms in (1 = double size).")
    blur = r.slider("Blur", 0.3, 0, 1, "Zoom blur while it moves.")
    env = r.envelope(HIT, "Hit starts zoomed and settles; Build pushes in; Constant holds the zoom.")
    mode = r.mode
    xf = m.add("Transform", "Xf", {
        "Size": E(f"1 + {amount}*({env})"),
        "Pivot": (0.5, 0.5),
    })
    m.publish(xf, "Pivot", "Zoom Centre", doc="The point it zooms towards.")
    zb = m.add("DirectionalBlur", "ZoomBlur", {
        "Input": Link(xf),
        "Type": BLUR_ZOOM,
        "Center": E(f"{xf}.Pivot"),
        "Length": E(f"{blur}*0.12*iif({mode} == {CONSTANT}, 0, {env})"),
    })
    r.publish_ease()
    m.main_input(xf, "Input")
    m.main_output(zb)
    m.apply = ON_CLIP + " Trim the clip to the beat: the punch lasts as long as the clip."
    m.expect = "First frame is zoomed in and blurred, then it eases back to normal by the last frame."
    m.tryout = "Envelope to Build and to Pulse; Amount to 0.6; move Zoom Centre onto a face."
    return m


def rgb_split() -> Macro:
    m = Macro("PFXRGBSplit", "PFX RGB Split", EFFECT, FX,
              "Red and blue pulled apart in opposite directions (chromatic aberration).")
    r = Rig(m, "Duration")
    amount = r.slider("Amount", 0.3, 0, 1, "Distance between the colour channels.")
    angle = r.slider("Angle", 0, -180, 180, "Direction of the split in degrees.")
    jitter = r.slider("Jitter", 0, 0, 1, "Random frame-to-frame change in distance.")
    env = r.envelope(CONSTANT)
    d = f"({amount}*0.03*({env})*(1 + {jitter}*(2*{rnd('floor(time)')} - 1)))"
    dx = f"{d}*cos({angle}*pi/180)"
    dy = f"{d}*{Y_ASPECT}*sin({angle}*pi/180)"
    red = m.add("Transform", "Red", {
        "Center": E(f"Point(0.5 + {dx}, 0.5 + {dy})"),
        "Edges": MIRROR,
        "ProcessGreen": 0, "ProcessBlue": 0, "ProcessAlpha": 0,
    })
    blue = m.add("Transform", "Blue", {
        "Input": Link(red),
        "Center": E(f"Point(0.5 - {dx}, 0.5 - {dy})"),
        "Edges": MIRROR,
        "ProcessRed": 0, "ProcessGreen": 0, "ProcessAlpha": 0,
    })
    r.publish_ease()
    m.main_input(red, "Input")
    m.main_output(blue)
    m.apply = ON_CLIP
    m.expect = "Red and cyan/blue fringes either side of every edge; green stays put."
    m.tryout = "Angle to 90 (vertical split); Jitter to 1; Envelope to Hit."
    return m


def _glitch(m: Macro, r: Rig, amount: str, split: str, flicker: str, hold: str, band: str,
            prob: str, gain: str) -> tuple[str, str]:
    """Shared glitch graph. Returns (first tool, last tool)."""
    step = f"floor(time/max(1, {hold}))"
    g = f"(iif({rnd(step + ' + 17')} < {prob}, 1, 0)*({gain}))"
    sign = f"iif({rnd(step + ' + 3')} < 0.5, -1, 1)"
    noise = m.add("FastNoise", "Bands", {
        "Width": 1920, "Height": 1080, "UseFrameFormatSettings": 1,
        "Detail": 1,
        "Contrast": 5,
        "Brightness": -0.5,
        "LockXY": 0,
        "XScale": 0.05,  # almost no change across x: the noise becomes horizontal bands
        "YScale": E(f"3 + (1 - {band})*60"),
        "Discontinuous": 1,
        "Seethe": E(f"{step}*7.31"),  # jump to a new pattern every Hold frames
        "SeetheRate": 0,
        "Color1Alpha": 1,
    })
    clamp = m.add("BrightnessContrast", "BandClamp", {
        "Input": Link(noise), "ClipBlack": 1, "ClipWhite": 1,
    })
    tear = m.add("Displace", "Tear", {
        "Foreground": Link(clamp),
        "Type": 1, "XChannel": 4, "YChannel": 4,
        "XRefraction": E(f"{amount}*0.2*{g}*{sign}"),
        "YRefraction": 0,
    })
    d = f"({split}*0.02*{g}*(0.5 + {rnd(step + ' + 29')}))"
    red = m.add("Transform", "Red", {
        "Input": Link(tear),
        "Center": E(f"Point(0.5 + {d}, 0.5)"),
        "Edges": MIRROR,
        "ProcessGreen": 0, "ProcessBlue": 0, "ProcessAlpha": 0,
    })
    blue = m.add("Transform", "Blue", {
        "Input": Link(red),
        "Center": E(f"Point(0.5 - {d}, 0.5)"),
        "Edges": MIRROR,
        "ProcessRed": 0, "ProcessGreen": 0, "ProcessAlpha": 0,
    })
    flick = m.add("BrightnessContrast", "Flicker", {
        "Input": Link(blue),
        "Gain": E(f"1 + {flicker}*{g}*({rnd('floor(time) + 41')} - 0.4)"),
    })
    return tear, flick


def digital_glitch() -> Macro:
    m = Macro("PFXDigitalGlitch", "PFX Digital Glitch", EFFECT, FX,
              "Bursts of torn horizontal bands with colour split and flicker.")
    r = Rig(m, "Duration")
    amount = r.slider("Amount", 0.5, 0, 1, "How far the bands tear sideways.")
    freq = r.slider("Frequency", 0.6, 0, 1, "How often a burst happens (1 = always).")
    hold = r.slider("Hold Frames", 3, 1, 12, "Frames each glitch pattern lasts.")
    band = r.slider("Band Size", 0.6, 0, 1, "Height of the torn bands.")
    split = r.slider("Colour Split", 0.5, 0, 1, "RGB separation during a burst.")
    flicker = r.slider("Flicker", 0.3, 0, 1, "Brightness flicker during a burst.")
    env = r.envelope(CONSTANT)
    first, last = _glitch(m, r, amount, split, flicker, hold, band, prob=freq, gain=env)
    r.publish_ease()
    m.main_input(first, "Input")
    m.main_output(last)
    m.apply = ON_CLIP
    m.expect = ("Every few frames, horizontal strips of the picture jump sideways with red/blue "
                "fringes and a brightness flicker; between bursts the picture is untouched.")
    m.tryout = "Frequency to 1; Hold Frames to 1 and 8; Band Size to 0 and 1; Amount to 1."
    return m


def flash_strobe() -> Macro:
    m = Macro("PFXFlashStrobe", "PFX Flash Strobe", EFFECT, FX,
              "A flash that fades, or a strobe. Set the colour to black for a black flash.")
    r = Rig(m, "Duration", "Sine", "Quad")
    intensity = r.slider("Intensity", 1, 0, 1, "Peak strength of the flash.")
    interval = r.slider("Strobe Frames", 0, 0, 24, "0 = one flash. Above 0 = frames on, then the same off.")
    exposure = r.slider("Exposure Boost", 0.5, 0, 1, "Blows out the picture under the flash.")
    env = r.envelope(HIT, "Hit flashes on the first frame and fades; Constant suits a strobe.")
    strobe = f"iif({interval} < 1, 1, iif(floor(time/max(1, {interval})) % 2 == 0, 1, 0))"
    f = clamp01(f"{intensity}*({env})*{strobe}")
    boost = m.add("BrightnessContrast", "Boost", {"Gain": E(f"1 + {exposure}*2*{f}")})
    colour = m.add("Background", "Colour", {
        "Width": 1920, "Height": 1080, "UseFrameFormatSettings": 1,
        "TopLeftRed": 1, "TopLeftGreen": 1, "TopLeftBlue": 1, "TopLeftAlpha": 1,
    })
    m.publish(colour, "TopLeftRed", "Flash Colour", doc="White by default; black gives a dip to black.",
              ControlGroup=1, Default=1)
    m.publish(colour, "TopLeftGreen", None, ControlGroup=1, Default=1)
    m.publish(colour, "TopLeftBlue", None, ControlGroup=1, Default=1)
    over = m.add("Merge", "Over", {
        "Background": Link(boost),
        "Foreground": Link(colour),
        "Size": 3,  # the card always covers the frame, whatever the clip size
        "Blend": E(f),
        "PerformDepthMerge": 0,
    })
    r.publish_ease()
    m.main_input(boost, "Input")
    m.main_output(over)
    m.apply = ON_CLIP + " Trim the clip to set how long the flash takes to fade."
    m.expect = "First frame is pure white, fading back to the normal picture by the last frame."
    m.tryout = ("Flash Colour to black; Strobe Frames to 2 with Envelope on Constant; "
                "Exposure Boost to 0 and 1.")
    return m


# ------------------------------------------------------------ cut effects

def whip_pan() -> Macro:
    m = Macro("PFXWhipPan", "PFX Whip Pan", EFFECT, CUTS,
              "The picture whips off-screen and the next shot whips in, hiding the cut in blur.")
    m.kind = "cut"
    r = Rig(m, "Duration", "Quint", "Quint")
    direction = r.combo("Direction", ["Left", "Right", "Up", "Down"], 0, "Which way the picture travels.")
    distance = r.slider("Distance", 1, 1, 3, "Whole screens travelled each side of the cut (1, 2 or 3).")
    blur = r.slider("Blur", 0.6, 0, 1, "Motion blur at the peak.")
    p, bell = r.P, r.bell()
    n = f"max(1, floor({distance} + 0.5))"
    dx = f"iif({direction} == 0, -1, iif({direction} == 1, 1, 0))"
    dy = f"iif({direction} == 2, 1, iif({direction} == 3, -1, 0))"
    length = f"({blur}*0.35*{bell}*{bell})"
    # Mirrored tiling repeats every 2 screens, so travelling 2*n screens ends
    # exactly where it started and the last frame is the untouched picture.
    pan = m.add("Transform", "Pan", {
        "Center": E(f"Point(0.5 + 2*{n}*{p}*{dx}, 0.5 + 2*{n}*{p}*{dy})"),
        "Edges": MIRROR,
    })
    smear = m.add("DirectionalBlur", "Smear", {
        "Input": Link(pan),
        "Type": BLUR_CENTERED,
        "Angle": E(f"iif({direction} < 2, 0, 90)"),
        "Length": E(length),
    })
    crop = m.add("Transform", "Crop", {
        "Input": Link(smear),
        "Size": E(f"1 + 1.2*{length}"),  # hides the dark edge the blur pulls in
    })
    r.publish_ease()
    m.main_input(pan, "Input")
    m.main_output(crop)
    m.apply = ON_CUT
    m.expect = ("Outgoing shot accelerates sideways into a streak, the cut happens inside the streak, "
                "incoming shot decelerates to rest. First and last frames are untouched.")
    m.tryout = "Each Direction; Distance to 3; Blur to 0 (you should see mirrored copies sliding past)."
    return m


def zoom_through() -> Macro:
    m = Macro("PFXZoomThrough", "PFX Zoom Through", EFFECT, CUTS,
              "Zooms into the outgoing shot and out of the incoming one, with zoom blur over the cut.")
    m.kind = "cut"
    r = Rig(m, "Duration", "Quint", "Quint")
    zoom = r.slider("Zoom", 1.2, -2, 2, "Positive zooms in through the cut, negative zooms out.")
    blur = r.slider("Blur", 0.6, 0, 1, "Zoom blur at the peak.")
    p, bell = r.P, r.bell()
    xf = m.add("Transform", "Xf", {
        # Scale doubles per unit of Zoom up to the cut, then restarts from the
        # reciprocal so the incoming shot arrives at exactly 1.
        "Size": E(f"2^({zoom}*(2*{p} - iif({p} < 0.5, 0, 2)))"),
        "Pivot": (0.5, 0.5),
        "Edges": MIRROR,
    })
    m.publish(xf, "Pivot", "Zoom Centre", doc="The point it zooms through.")
    zb = m.add("DirectionalBlur", "ZoomBlur", {
        "Input": Link(xf),
        "Type": BLUR_ZOOM,
        "Center": E(f"{xf}.Pivot"),
        "Length": E(f"{blur}*0.4*{bell}"),
    })
    r.publish_ease()
    m.main_input(xf, "Input")
    m.main_output(zb)
    m.apply = ON_CUT
    m.expect = ("Outgoing shot rushes towards you and blurs; after the cut the incoming shot "
                "continues the same move and settles. First and last frames are untouched.")
    m.tryout = "Zoom to -1.2 (pulls back instead); Blur to 0 and 1; move Zoom Centre."
    return m


def spin() -> Macro:
    m = Macro("PFXSpin", "PFX Spin", EFFECT, CUTS,
              "Spins the picture through the cut with rotational motion blur.")
    m.kind = "cut"
    r = Rig(m, "Duration", "Quint", "Quint")
    turns = r.slider("Rotations", 1, -3, 3, "Whole turns; negative spins the other way.")
    zoom = r.slider("Zoom", 0.3, 0, 1, "Extra punch-in at the peak.")
    blur = r.slider("Blur", 0.6, 0, 1, "Shutter angle of the motion blur.")
    p, bell = r.P, r.bell()
    n = f"iif(abs(floor({turns} + 0.5)) < 1, 1, floor({turns} + 0.5))"
    xf = m.add("Transform", "Xf", {
        "Angle": E(f"360*{n}*{p}"),
        "Size": E(f"1 + {zoom}*{bell}"),
        "Edges": MIRROR,
        "MotionBlur": 1,
        "Quality": 10,
        "ShutterAngle": E(f"360*{blur}"),
    })
    r.publish_ease()
    m.main_input(xf, "Input")
    m.main_output(xf)
    m.apply = ON_CUT
    m.expect = ("Picture spins one full turn, fastest and most blurred at the cut, and lands "
                "upright. Corners fill with mirrored picture, never black.")
    m.tryout = "Rotations to -1 and 2; Zoom to 0; Blur to 0 (spin with no smear)."
    return m


def glitch_cut() -> Macro:
    m = Macro("PFXGlitchCut", "PFX Glitch Cut", EFFECT, CUTS,
              "A glitch burst that swells into the cut and dies away after it.")
    m.kind = "cut"
    r = Rig(m, "Duration", "Sine", "Sine")
    amount = r.slider("Amount", 0.7, 0, 1, "How far the bands tear sideways.")
    hold = r.slider("Hold Frames", 2, 1, 12, "Frames each glitch pattern lasts.")
    band = r.slider("Band Size", 0.6, 0, 1, "Height of the torn bands.")
    split = r.slider("Colour Split", 0.7, 0, 1, "RGB separation at the peak.")
    flicker = r.slider("Flicker", 0.4, 0, 1, "Brightness flicker at the peak.")
    bell = r.bell()
    first, last = _glitch(m, r, amount, split, flicker, hold, band, prob=f"1.6*{bell}", gain=bell)
    r.publish_ease()
    m.main_input(first, "Input")
    m.main_output(last)
    m.apply = ON_CUT
    m.expect = ("Glitching starts faint, is strongest on the cut and fades out. First and last "
                "frames are untouched.")
    m.tryout = "Amount to 1; Hold Frames to 1; Colour Split to 0."
    return m


# ---------------------------------------------------------- true transitions

def _transitions_attr(method: str) -> dict:
    table = Table()
    table.items.append((0, method))
    return {"Transitions": table}


def flash_dip() -> Macro:
    m = Macro("PFXFlashDip", "PFX Flash Dip", TRANSITION, FX,
              "Cuts from A to B under a flash of colour. Black gives a dip to black.")
    m.kind = "transition"
    r = Rig(m, "Transition", "Sine", "Sine")
    intensity = r.slider("Intensity", 1, 0, 1, "Peak strength of the flash.")
    soft = r.slider("Crossfade", 0.15, 0, 1, "How much of the duration A and B overlap (0 = hard cut).")
    exposure = r.slider("Exposure Boost", 0.5, 0, 1, "Blows out the picture under the flash.")
    p, bell = r.P, r.bell()
    f = clamp01(f"{intensity}*{bell}")
    mix = m.add("Dissolve", "AB", {
        "Mix": E(clamp01(f"({p} - 0.5)/max(0.001, {soft}) + 0.5")),
    }, attrs=_transitions_attr("DFTDissolve"))
    boost = m.add("BrightnessContrast", "Boost", {
        "Input": Link(mix), "Gain": E(f"1 + {exposure}*2*{f}"),
    })
    colour = m.add("Background", "Colour", {
        "Width": 1920, "Height": 1080, "UseFrameFormatSettings": 1,
        "TopLeftRed": 1, "TopLeftGreen": 1, "TopLeftBlue": 1, "TopLeftAlpha": 1,
    })
    m.publish(colour, "TopLeftRed", "Flash Colour", doc="White by default; black gives a dip to black.",
              ControlGroup=1, Default=1)
    m.publish(colour, "TopLeftGreen", None, ControlGroup=1, Default=1)
    m.publish(colour, "TopLeftBlue", None, ControlGroup=1, Default=1)
    over = m.add("Merge", "Over", {
        "Background": Link(boost), "Foreground": Link(colour),
        "Size": 3, "Blend": E(f), "PerformDepthMerge": 0,
    })
    r.publish_ease()
    m.main_input(mix, "Background")
    m.main_input(mix, "Foreground")
    m.main_output(over)
    m.apply = ON_EDIT_POINT
    m.expect = "Clip A brightens to full white at the midpoint, then B emerges from the white."
    m.tryout = "Flash Colour to black; Crossfade to 0 and 1; lengthen the transition on the timeline."
    return m


def luma_wipe() -> Macro:
    m = Macro("PFXLumaWipe", "PFX Luma Wipe", TRANSITION, FX,
              "Wipes A to B along a soft edge, from a clean directional wipe to an organic burn.")
    m.kind = "transition"
    r = Rig(m, "Transition", "Sine", "Sine")
    angle = r.slider("Angle", 0, -180, 180, "Direction the wipe travels, in degrees.")
    organic = r.slider("Organic", 0.35, 0, 1, "0 = straight edge, 1 = noise pattern only.")
    c, s = f"0.5*cos({angle}*pi/180)", f"0.5*sin({angle}*pi/180)"
    colours = Table()
    colours.items.append((0, T(None, 0, 0, 0, 1)))
    colours.items.append((1, T(None, 1, 1, 1, 1)))
    ramp = m.add("Background", "Ramp", {
        "Width": 1920, "Height": 1080, "UseFrameFormatSettings": 1,
        "Type": Fu("Gradient"),
        "Gradient": T("Gradient", Colors=colours),
        "Start": E(f"Point(0.5 - {c}, 0.5 - {s})"),
        "End": E(f"Point(0.5 + {c}, 0.5 + {s})"),
    })
    noise = m.add("FastNoise", "Noise", {
        "Width": 1920, "Height": 1080, "UseFrameFormatSettings": 1,
        "Detail": 4, "Contrast": 1.5, "XScale": 4, "SeetheRate": 0, "Color1Alpha": 1,
    })
    m.publish(noise, "XScale", "Pattern Scale", doc="Size of the organic pattern (higher = finer).",
              Default=4, MinScale=1, MaxScale=20)
    pattern = m.add("Merge", "Pattern", {
        "Background": Link(ramp), "Foreground": Link(noise),
        "Blend": E(clamp01(organic)), "PerformDepthMerge": 0,
    })
    wipe = m.add("Dissolve", "AB", {
        "Operation": Fu("DFTLumaRamp"),
        "Map": Link(pattern),
        "Mix": E(r.P),
        "DFTLumaRamp.Softness": 0.15,
    }, attrs=_transitions_attr("DFTLumaRamp"))
    m.publish(wipe, "DFTLumaRamp.Softness", "Softness", doc="Width of the soft edge.",
              Default=0.15, MinScale=0, MaxScale=1)
    r.publish_ease()
    m.main_input(wipe, "Background")
    m.main_input(wipe, "Foreground")
    m.main_output(wipe)
    m.apply = ON_EDIT_POINT
    m.expect = "B replaces A along a soft, slightly ragged edge that sweeps across the frame."
    m.tryout = "Organic to 0 (clean wipe) and 1 (blotchy dissolve); Angle to 90 and 180; Softness to 0."
    return m


ALL = [
    camera_shake, zoom_punch, rgb_split, digital_glitch, flash_strobe,
    whip_pan, zoom_through, spin, glitch_cut,
    flash_dip, luma_wipe,
]


def build_all() -> list[Macro]:
    return [fn() for fn in ALL]
