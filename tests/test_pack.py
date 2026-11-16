"""Proves the checks catch the mistakes they exist for.

    python -m unittest discover tests
"""

import unittest

from vfxpack.definitions import build_all
from vfxpack.luatable import LuaSyntaxError, dumps, parse
from vfxpack.simulate import simulate
from vfxpack.validate import validate_text

MACROS = {m.ident: m for m in build_all()}


def text_of(ident: str) -> str:
    return MACROS[ident].text()


class GeneratedPack(unittest.TestCase):
    def test_every_template_passes(self):
        for m in MACROS.values():
            with self.subTest(m.title):
                self.assertEqual(validate_text(m.text(), m.category), [])
                self.assertEqual(simulate(m.text(), m.kind)[0], [])

    def test_output_round_trips(self):
        for m in MACROS.values():
            with self.subTest(m.title):
                self.assertEqual(dumps(parse(m.text())) + "\n", m.text())

    def test_names_are_unique_across_the_pack(self):
        names = [t.name.lower() for m in MACROS.values() for t in m.tools]
        self.assertEqual(len(names), len(set(names)))
        titles = [m.title.lower() for m in MACROS.values()]
        self.assertEqual(len(titles), len(set(titles)))


class ValidatorCatches(unittest.TestCase):
    def broken(self, ident: str, old: str, new: str, expect: str, category: str | None = None):
        good = text_of(ident)
        self.assertIn(old, good, "test is stale: text to break not found")
        problems = validate_text(good.replace(old, new, 1), category or MACROS[ident].category)
        self.assertTrue(any(expect in p for p in problems), f"expected {expect!r} in {problems}")

    def test_unbalanced_brace(self):
        good = text_of("PFXSpin")
        self.assertTrue(validate_text(good[: good.rindex("}")], "Effects")[0].startswith("syntax"))

    def test_missing_comma(self):
        self.broken("PFXSpin", "Edges = Input { Value = 3, },", "Edges = Input { Value = 3, }", "syntax")

    def test_raw_newline_in_string(self):
        self.broken("PFXSpin", 'Name = "Zoom"', 'Name = "Zo\nom"', "unterminated string")

    def test_invented_input_name(self):
        self.broken("PFXSpin", "Angle = Input", "Rotation = Input", "no confirmed input 'Rotation'")

    def test_invented_tool(self):
        self.broken("PFXWhipPan", "= DirectionalBlur {", "= MotionSmear {", "not in the confirmed vocabulary")

    def test_published_control_points_nowhere(self):
        self.broken("PFXSpin", 'Source = "NumberIn2"', 'Source = "NumberIn7"', "is not written in the file")

    def test_published_control_points_at_missing_tool(self):
        self.broken("PFXSpin", 'SourceOp = "PFXSpin_Progress", Source = "Curve"',
                    'SourceOp = "PFXSpin_Easing", Source = "Curve"', "not in the file")

    def test_duplicate_tool_name_ignoring_case(self):
        self.broken("PFXRGBSplit", "PFXRGBSplit_Blue = Transform", "PFXRGBSPLIT_RED = Transform", "used twice")

    def test_fuid_written_as_string(self):
        self.broken("PFXSpin", 'FuID { "Duration" }', '"Duration"', "expects FuID")

    def test_unknown_ease(self):
        self.broken("PFXSpin", 'FuID { "Quint" }', 'FuID { "Smooth" }', "not a confirmed value")

    def test_expression_reads_missing_tool(self):
        self.broken("PFXZoomPunch", 'Expression = "PFXZoomPunch_Xf.Pivot"',
                    'Expression = "PFXZoomPunch_Zoom.Pivot"', "no tool is named")

    def test_expression_uses_noise(self):
        self.broken("PFXSpin", '"360*iif(', '"noise(time)*360*iif(', "'noise'")

    def test_expression_unbalanced(self):
        self.broken("PFXSpin", '"360*iif(', '"360*(iif(', "unbalanced parentheses")

    def test_transition_missing_second_input(self):
        self.broken("PFXFlashDip", "MainInput2 = InstanceInput", "Extra = InstanceInput", "needs image inputs")

    def test_effect_with_transition_timing(self):
        self.broken("PFXFlashDip", "MainInput2 =", "MainInput2 =", "needs 'Duration'", category="Effects")

    def test_generator_at_default_size(self):
        self.broken("PFXFlashStrobe", "UseFrameFormatSettings = Input { Value = 1, },",
                    "UseFrameFormatSettings = Input { Value = 0, },", "320x240")

    def test_wire_to_missing_tool(self):
        self.broken("PFXWhipPan", 'SourceOp = "PFXWhipPan_Smear"', 'SourceOp = "PFXWhipPan_Blur"', "not in the file")

    def test_dropdown_option_count(self):
        self.broken("PFXWhipPan", '{ CCS_AddString = "Down", },', "", "does not match the number of options")

    def test_parser_reports_position(self):
        with self.assertRaises(LuaSyntaxError) as ctx:
            parse("{\n\tTools = ordered() {\n\t\tA = Merge { Inputs = { Blend = } }\n\t}\n}")
        self.assertEqual(ctx.exception.line, 3)


class SimulatorCatches(unittest.TestCase):
    def broken(self, ident: str, old: str, new: str, expect: str):
        good = text_of(ident)
        self.assertIn(old, good, "test is stale: text to break not found")
        problems, _ = simulate(good.replace(old, new), MACROS[ident].kind)
        self.assertTrue(any(expect in p for p in problems), f"expected {expect!r} in {problems[:3]}")

    def test_whip_pan_that_does_not_land(self):
        # travelling an odd number of screens ends on a mirrored frame
        self.broken("PFXWhipPan", "0.5 + 2*max(", "0.5 + 1*max(", "picture not untouched at progress 1")

    def test_spin_that_ends_tilted(self):
        self.broken("PFXSpin", '"360*iif(', '"350*iif(', "picture not untouched at progress 1")

    def test_zoom_that_does_not_return(self):
        self.broken("PFXZoomThrough", "< 0.5, 0, 2)", "< 0.5, 0, 1)", "picture not untouched at progress 1")

    def test_blend_out_of_range(self):
        self.broken("PFXFlashStrobe", 'Expression = "min(1, max(0, ', 'Expression = "3*min(1, max(0, ', "leaves 0..1")

    def test_division_by_zero(self):
        self.broken("PFXFlashDip", "max(0.001, ", "max(0, ", "cannot evaluate")

    def test_transition_that_starts_on_b(self):
        self.broken("PFXLumaWipe", 'Expression = "PFXLumaWipe_Ctl.NumberIn1"',
                    'Expression = "1 - PFXLumaWipe_Ctl.NumberIn1"', "expected 0")


if __name__ == "__main__":
    unittest.main()
