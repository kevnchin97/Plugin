# Pulse FX

Punchy, music-video style effects and transitions for the DaVinci Resolve Studio
Edit page: shake, zoom punch, RGB split, glitch, flash, whip pan, spin. Drag one
onto a clip, an adjustment clip or a cut. No keyframes, no Fusion page.

Built for Resolve Studio 21 on Windows.

> **Status: untested in Resolve.** The files are generated and pass every check
> that can run without Resolve, but none has been loaded in the application yet.
> [TESTING.md](TESTING.md) is the checklist for the first real test.

## Install

1. Quit Resolve.
2. Double-click `install.bat`.
3. Start Resolve.

`install.bat` copies `dist/PulseFX.drfx` to
`%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates`.
You can also double-click `dist/PulseFX.drfx` and let Resolve import it.

| Command | Does |
|---|---|
| `install.bat` | Installs the bundle |
| `install.bat loose` | Installs the same templates as loose files, for debugging |
| `install.bat uninstall` | Removes both |

The installer has not been run on Windows yet. If it fails, copy the `.drfx`
to the folder above by hand.

## What is in it

Every effect follows the length of the clip it sits on: trim the clip and the
animation retimes. Most have an **Envelope** menu (Hit, Build, Pulse, Constant)
and **Curve / Ease In / Ease Out** menus.

| Template | Drop it on | Does |
|---|---|---|
| PFX Camera Shake | a clip | Handheld jitter up to an impact shake |
| PFX Zoom Punch | a clip | Punch-in on the beat that settles back |
| PFX RGB Split | a clip | Red and blue pulled apart |
| PFX Digital Glitch | a clip | Bursts of torn bands, colour split, flicker |
| PFX Flash Strobe | a clip | A fading flash, a strobe, or a black flash |
| PFX Whip Pan | an adjustment clip over a cut | Whips one shot out and the next in |
| PFX Zoom Through | an adjustment clip over a cut | Zooms through the cut with blur |
| PFX Spin | an adjustment clip over a cut | Spins through the cut with motion blur |
| PFX Glitch Cut | an adjustment clip over a cut | Glitch that peaks on the cut |
| PFX Flash Dip | a cut (transition) | A to B under a flash of colour |
| PFX Luma Wipe | a cut (transition) | Soft wipe, clean or organic |

Controls for each are in [docs/EFFECTS.md](docs/EFFECTS.md).

**Cut effects** go on an adjustment clip placed on the track above a cut,
centred on it and roughly 12 to 20 frames long. They start and end on the
untouched picture and peak in the middle, so the distortion hides the edit.
They work on clips without handles, which true transitions do not.

## What has and has not been checked

`python build.py` checked, for all 11 templates:

- each file parses as a Fusion settings table (the parser was first run against
  613 real exported files);
- every tool type, input name and menu value is one that appears in real
  Resolve files, listed in `vfxpack/vocab.py` with its source;
- every wire and every published control points at something that exists in
  the file, tool names are unique, generators follow the timeline resolution;
- the animation maths holds across 157,248 evaluations: nothing divides by
  zero, mixes stay in range, cut effects leave the first and last frame
  untouched, transitions start on A and end on B.

Not checked, because it needs Resolve:

- whether Resolve loads each template and shows it in the library;
- whether each control appears and does what its label says;
- how anything looks. Strengths, blur lengths and noise settings are first
  guesses.

The assumptions most likely to be wrong are listed at the end of
[TESTING.md](TESTING.md); where each fact came from is in
[docs/EVIDENCE.md](docs/EVIDENCE.md).

## How it works

Each template is a Fusion macro built from stock GPU nodes (Transform,
Directional Blur, Displace, Merge, Dissolve, Fast Noise). There is no OpenFX,
Fuse or DCTL in this version: nothing in the first set needed one.

Two parts are shared by every template and written once, in `vfxpack/rig.py`:

- **Progress.** One Anim Curves modifier outputs 0 to 1 across the clip (or the
  transition). This is the mechanism Resolve's own templates use.
- **Controls.** A Custom tool that is not wired into the picture holds that
  progress value and the sliders. Every animated input is an expression that
  reads them.

## Add an effect

1. Add a function to `vfxpack/definitions.py` and list it in `ALL`:

   ```python
   def my_effect() -> Macro:
       m = Macro("PFXMyEffect", "PFX My Effect", EFFECT, FX, "One line on what it does.")
       r = Rig(m, "Duration")                         # progress + control holder
       amount = r.slider("Amount", 0.5, 0, 1, "What the slider does.")
       env = r.envelope(HIT)                          # the shared Envelope menu
       xf = m.add("Transform", "Xf", {"Size": E(f"1 + {amount}*({env})")})
       r.publish_ease()
       m.main_input(xf, "Input")
       m.main_output(xf)
       m.apply, m.expect, m.tryout = "...", "...", "..."   # for TESTING.md
       return m
   ```

2. Run `python build.py`. It regenerates the bundle, `docs/EFFECTS.md` and
   `TESTING.md`, or stops and tells you what is wrong.

A new tool or input must be added to `vfxpack/vocab.py` first, with where you
saw it. The build refuses names that are not listed; that is deliberate. The
best source is your own Resolve: select a node on the Fusion page, copy it and
paste into a text editor.

## Develop

Needs Python 3.10 or newer, no packages.

```
python build.py                      # generate, check, package
python -m unittest discover tests    # 28 tests, including that the checks catch broken files
```

| Path | What |
|---|---|
| `vfxpack/definitions.py` | The effects |
| `vfxpack/rig.py` | Shared progress driver and controls |
| `vfxpack/graph.py` | Builds and writes one macro |
| `vfxpack/vocab.py` | Allowed tools, inputs and values, with sources |
| `vfxpack/validate.py` | Structure checks on a `.setting` or `.drfx` |
| `vfxpack/simulate.py` | Evaluates the expressions and checks the maths |
| `vfxpack/luatable.py` | Reads and writes the settings file format |
| `dist/` | Built bundle and loose templates |

## Next

Once the first set works in Resolve: VHS/CRT, echo trails, film burn and light
leaks, halftone, neon edge, kaleidoscope, pixel sort, stutter, heat distortion,
fisheye, grain, duotone. Pixel sort is the one most likely to need a Fuse.
