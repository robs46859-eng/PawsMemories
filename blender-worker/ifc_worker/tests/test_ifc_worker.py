import tempfile
import unittest
from pathlib import Path

from ifc_worker import WorkerError, _quantity_factor, convert_ifc, export_bim, inspect_ifc, validate_glb

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "fixtures"

class IfcWorkerTests(unittest.TestCase):
    def test_dimensional_quantity_conversion(self):
        self.assertAlmostEqual(_quantity_factor("Length", 0.001), 0.001)
        self.assertAlmostEqual(_quantity_factor("NetArea", 0.001), 0.000001)
        self.assertAlmostEqual(_quantity_factor("GrossVolume", 0.001), 0.000000001)

    def test_inspect_has_units_ids_and_semantics(self):
        _, report = inspect_ifc(str(FIXTURES / "small-building.ifc"))
        self.assertEqual(report["schema"], "IFC4")
        self.assertEqual(report["sourceUnit"], "mm")
        self.assertGreaterEqual(report["elementCount"], 15)
        self.assertTrue(all(item["globalId"] for item in report["elements"]))
        self.assertIn("IfcWall", report["entitiesByClass"])

    def test_malformed_and_unsupported_fail_closed(self):
        for name in ("malformed-building.ifc", "unsupported-schema.ifc"):
            with self.subTest(name=name), self.assertRaises(WorkerError):
                inspect_ifc(str(FIXTURES / name))

    def test_convert_produces_valid_glb_and_sidecar(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "building.glb"
            sidecar = Path(temp) / "building.json"
            report = convert_ifc(str(FIXTURES / "small-building.ifc"), str(output), str(sidecar))
            self.assertTrue(validate_glb(str(output))["meshes"])
            self.assertTrue(sidecar.is_file())
            self.assertTrue(any(item["hasGeometry"] for item in report["elements"]))

    def test_two_room_export_round_trip(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "roundtrip.ifc"
            report = export_bim(str(FIXTURES / "two-room-building.json"), str(output))
            self.assertEqual(report["exportedElementCount"], 15)
            _, inspected = inspect_ifc(str(output))
            self.assertEqual(inspected["schema"], "IFC4")
            self.assertEqual(inspected["entitiesByClass"]["IfcSpace"], 2)
            self.assertEqual(inspected["entitiesByClass"]["IfcOpeningElement"], 2)

if __name__ == "__main__":
    unittest.main()
