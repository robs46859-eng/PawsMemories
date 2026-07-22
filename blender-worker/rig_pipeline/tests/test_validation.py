import math
import pathlib
import sys
import unittest


PIPELINE_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from validation import canonical_target_name, facial_capability, measure_morph, print_metrics_pass, quaternion_xyzw  # noqa: E402


class FacialMeasurementTests(unittest.TestCase):
    def setUp(self):
        self.basis = [(float(index), 0.0, 0.0) for index in range(20)]

    def test_empty_morph_is_not_deformation(self):
        measured = measure_morph(self.basis, list(self.basis), range(20), 10.0)
        self.assertFalse(measured["deformationPass"])
        self.assertFalse(measured["pass"])
        self.assertEqual(measured["displacedVertices"], 0)

    def test_nonlocal_morph_is_rejected(self):
        target = list(self.basis)
        target[15] = (15.0, 0.1, 0.0)
        measured = measure_morph(self.basis, target, range(0, 10), 10.0)
        self.assertTrue(measured["deformationPass"])
        self.assertFalse(measured["localityPass"])
        self.assertFalse(measured["pass"])

    def test_nonfinite_morph_is_rejected(self):
        target = list(self.basis)
        target[2] = (2.0, math.nan, 0.0)
        measured = measure_morph(self.basis, target, range(20), 10.0)
        self.assertFalse(measured["finite"])
        self.assertFalse(measured["pass"])

    def test_localized_bounded_morph_passes(self):
        target = list(self.basis)
        for index in range(8):
            target[index] = (float(index), 0.05, 0.0)
        measured = measure_morph(self.basis, target, range(10), 10.0)
        self.assertTrue(measured["localityPass"])
        self.assertTrue(measured["deformationPass"])
        self.assertTrue(measured["pass"])

    def test_aliases_map_without_renaming_source(self):
        self.assertEqual(canonical_target_name("viseme_A"), "A")
        self.assertEqual(canonical_target_name("eyeBlinkLeft"), "eyeBlinkLeft")
        self.assertIsNone(canonical_target_name("Smile"))

    def test_capability_uses_only_passing_measurements(self):
        targets = [
            {"canonicalName": name, "pass": True}
            for name in ["A", "B", "C", "D", "E", "F", "G", "H", "X", "jawOpen", "eyeBlinkLeft", "eyeBlinkRight"]
        ]
        self.assertEqual(facial_capability(targets, []), "full")
        targets[-1]["pass"] = False
        self.assertEqual(facial_capability(targets, []), "partial")
        self.assertEqual(facial_capability([], []), "body_only")

    def test_blender_quaternion_is_serialized_as_three_xyzw(self):
        class Quaternion:
            w = 1.0
            x = 2.0
            y = 3.0
            z = 4.0

        self.assertEqual(quaternion_xyzw(Quaternion()), [2.0, 3.0, 4.0, 1.0])

    def test_print_metrics_require_one_finite_watertight_component(self):
        valid = {
            "objectCount": 1,
            "connectedComponents": 1,
            "nonManifoldEdges": 0,
            "finiteGeometry": True,
            "triangleCount": 1200,
            "volumeCubicMeters": 0.25,
        }
        self.assertTrue(print_metrics_pass(valid, 5000))
        for key, value in (
            ("objectCount", 2),
            ("connectedComponents", 2),
            ("nonManifoldEdges", 1),
            ("finiteGeometry", False),
            ("triangleCount", 5001),
            ("volumeCubicMeters", 0.0),
        ):
            invalid = {**valid, key: value}
            self.assertFalse(print_metrics_pass(invalid, 5000), key)


if __name__ == "__main__":
    unittest.main()
