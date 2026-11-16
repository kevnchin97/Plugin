# What this pack rests on

Nothing here was run in Resolve. This file records where each fact came from,
so a failed test can be traced to the assumption behind it.

## Sources

| Tag | Source | Used for |
|---|---|---|
| R | 613 real exported `.setting` files in the public [Reactor](https://gitlab.com/WeSuckLess/Reactor) repository, parsed with `vfxpack/luatable.py` | Tool IDs, input IDs, the numbers real files store for menus, UserControls syntax |
| S | The `setting-format` and `fusion-realities` references in [open-fusion-mcp](https://github.com/legionsound/open-fusion-mcp) (MIT). Its authors mined the 417 templates inside Resolve Studio 21.1 and checked IDs against the running app | Edit-page template structure, Anim Curves syntax, the built-in Cross Dissolve skeleton, expression rules verified live on 21.1 |
| M | Fusion 21.1 reference manual, as distilled in the same project (page numbers cited there) | Template folders, `.drfx` rules, menu option order |
| D | Blackmagic DCTL developer notes, via the [ResolveCafe mirror](https://github.com/CommandPost/ResolveCafe/blob/main/docs/developers/dctl.md) | DCTL transition format |

Blackmagic's own manual pages and the official DCTL wiki could not be fetched
from the build environment (blocked hosts), so M and D are second-hand.

## Decisions the research settled

**Folder layout and install path (M, S).** Edit-page templates live under
`Fusion/Templates/Edit/<Effects|Transitions|Titles|Generators>/`; subfolders
become bins. On Windows the user folder is
`%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates`.
Resolve reads it only at startup.

**What a `.drfx` is (M, S).** A zip renamed to `.drfx` whose top-level folder
is `Edit` (and/or `Fusion`). It holds `.setting` files, optional `.png` icons
with the same base name (104 x 58) and media assets. Resolve does not unpack
it; deleting the file removes the templates. The sources describe templates,
icons and media only, so this pack assumes a bundle cannot carry Fuses or
DCTLs.

**Template structure (S).** Effects are a group with `MainInput1` and
`MainOutput1`. Transitions need `MainInput1` (outgoing) and `MainInput2`
(incoming). All 122 transitions and 42 of 45 effects in the 21.1 corpus follow
this.

**Clip-length timing (S, M).** The Anim Curves modifier (registry ID
`LUTLookup`) outputs 0..1 over the clip (`Source = Duration`) or over the
transition (`Source = Transition`). It is the commonest modifier in shipped
Edit templates (405 uses).

**DCTL transitions (D).** A transition DCTL is a function taking the frame
size, pixel position and RGBA textures for the From and To clips, reading the
global `TRANSITION_PROGRESS` (0..1). It only runs inside the *DCTL* transition
plugin (Edit page > OpenFX > Transition > ResolveFX Color > DCTL), where the
editor picks the file from a list. It cannot appear as its own drag-and-drop
item in the Effects Library and cannot ship in a `.drfx`, so none of the first
eleven effects use it.

**No Fuse, DCTL or OpenFX in this version.** All eleven effects are built from
GPU-accelerated stock nodes. Nothing in the first set needed OpenFX. Pixel sort
and true datamosh on the later list are the likely first candidates for a Fuse.

## Confidence by item

Seen verbatim in real files and used the same way here:

- The group / `InstanceInput` / `InstanceOutput` wrapper and `MainInput` naming.
- `LUTLookup` with `Source`, `Curve`, `EaseIn`, `EaseOut`, `Lookup` and its `LUTBezier`.
- `Dissolve` with `Transitions = { [0] = "DFTDissolve" }` and the `DFTLumaRamp` form.
- Per-channel `Transform` (`ProcessRed/Green/Blue/Alpha = 0`) for colour split:
  the Muse Tools glitch pack in Reactor does chromatic aberration this way.
- Expressions that read another tool's input (`Tool.Input`), `iif`, `Point`,
  `time`, bare `sin`/`abs`/`floor`, floored `%`.
- A `Custom` tool used as a slider holder read by expressions.
- Overriding a `Custom` tool's `NumberIn` with a `CheckboxControl` (seen) and a
  `ComboControl` with `CCS_AddString` options overriding a number input (seen
  on a Dissolve). The combination used here, a ComboControl on a Custom
  `NumberIn`, is one step beyond what was seen.

Inferred, and listed in `TESTING.md` as the first suspects:

- Which option each stored menu number selects (`Edges`, DirectionalBlur
  `Type`, Displace `Type` and channel). The numbers are from real files; their
  meaning is the manual's menu order.
- That `Source = Duration` spans an adjustment clip the same way it spans a
  video clip.
- That Transform motion blur evaluates expression-driven inputs between frames.
- All look-and-feel constants (blur lengths, noise contrast, shake speed).
  These are first guesses and expected to need tuning.
