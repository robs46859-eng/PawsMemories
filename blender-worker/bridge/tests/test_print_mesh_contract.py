import math
import struct
import sys
import unittest
from pathlib import Path


BRIDGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRIDGE_DIR))

from print_mesh_contract import (  # noqa: E402
    format_repair_failure,
    inspect_binary_stl,
    validate_print_metrics,
)


def binary_stl(triangles):
    payload = bytearray(b"Pawsome3D test STL".ljust(80, b"\0"))
    payload.extend(struct.pack("<I", len(triangles)))
    for vertices in triangles:
        payload.extend(struct.pack("<12fH", 0.0, 0.0, 1.0, *(value for vertex in vertices for value in vertex), 0))
    return bytes(payload)


def tetrahedron(offset=0.0):
    a = (offset + 0.0, 0.0, 0.0)
    b = (offset + 100.0, 0.0, 0.0)
    c = (offset + 0.0, 100.0, 0.0)
    d = (offset + 0.0, 0.0, 100.0)
    return [(a, c, b), (a, b, d), (a, d, c), (b, c, d)]


class PrintMeshContractTests(unittest.TestCase):
    def test_closed_connected_finite_scaled_stl_passes(self):
        result = inspect_binary_stl(binary_stl(tetrahedron()), 100.0)

        self.assertTrue(result["validation"]["passed"])
        self.assertEqual(result["metrics"]["non_manifold_edges"], 0)
        self.assertEqual(result["metrics"]["component_count"], 1)

    def test_open_mesh_fails_watertight_gate(self):
        result = inspect_binary_stl(binary_stl(tetrahedron()[:-1]), 100.0)

        self.assertFalse(result["validation"]["passed"])
        self.assertGreater(result["metrics"]["non_manifold_edges"], 0)
        self.assertIn("open or non-manifold edges", " ".join(result["validation"]["issues"]))

    def test_disconnected_closed_shells_fail_connected_gate(self):
        result = inspect_binary_stl(binary_stl(tetrahedron() + tetrahedron(200.0)), 100.0)

        self.assertFalse(result["validation"]["passed"])
        self.assertEqual(result["metrics"]["component_count"], 2)

    def test_non_finite_vertices_fail_closed(self):
        triangles = tetrahedron()
        triangles[0] = ((math.nan, 0.0, 0.0), triangles[0][1], triangles[0][2])
        result = inspect_binary_stl(binary_stl(triangles), 100.0)

        self.assertFalse(result["validation"]["passed"])
        self.assertIn("finite vertices", " ".join(result["validation"]["issues"]))

    def test_wrong_height_fails_physical_size_gate(self):
        result = inspect_binary_stl(binary_stl(tetrahedron()), 75.0)

        self.assertFalse(result["validation"]["passed"])
        self.assertIn("expected 75", " ".join(result["validation"]["issues"]))

    def test_degenerate_triangle_fails(self):
        triangles = tetrahedron() + [((0.0, 0.0, 0.0), (1.0, 1.0, 1.0), (2.0, 2.0, 2.0))]
        result = inspect_binary_stl(binary_stl(triangles), 100.0)

        self.assertFalse(result["validation"]["passed"])
        self.assertGreater(result["metrics"]["degenerate_faces"], 0)

    def test_malformed_stl_fails_format_gate(self):
        result = inspect_binary_stl(b"not an stl", 100.0)

        self.assertFalse(result["validation"]["passed"])
        self.assertIn("84-byte", result["metrics"]["format_error"])

    def test_diagnostics_are_actionable_and_bounded(self):
        validation = validate_print_metrics(
            {
                "vertex_count": 10,
                "finite_vertex_count": 10,
                "triangle_count": 5,
                "non_manifold_edges": 7,
                "degenerate_faces": 2,
                "component_count": 3,
                "dimensions_mm": {"x": 10.0, "y": 20.0, "z": 100.0},
            },
            100.0,
        )
        message = format_repair_failure(validation)

        self.assertIn("Automatic mesh repair", message)
        self.assertIn("closed, connected solid", message)
        self.assertLess(len(message), 500)


if __name__ == "__main__":
    unittest.main()
