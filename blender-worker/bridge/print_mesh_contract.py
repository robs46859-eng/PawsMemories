"""Pure-Python manufacturing checks for Blender print derivatives.

This module deliberately has no bpy dependency. The Blender bridge uses it for
the in-memory mesh and for the exact STL bytes that will cross the provider
boundary, while normal Python tests exercise the fail-closed contract.
"""

from __future__ import annotations

import math
import struct
from typing import Any


MIN_PRINT_HEIGHT_MM = 25.0
MAX_PRINT_HEIGHT_MM = 300.0


def _check(name: str, passed: bool, detail: str) -> dict[str, Any]:
    return {"name": name, "passed": bool(passed), "detail": detail}


def validate_print_metrics(metrics: dict[str, Any], target_height_mm: float) -> dict[str, Any]:
    """Evaluate topology, finite geometry, connectivity, and physical scale."""
    dimensions = metrics.get("dimensions_mm") or {}
    values = [dimensions.get(axis) for axis in ("x", "y", "z")]
    dimensions_finite = all(isinstance(value, (int, float)) and math.isfinite(value) for value in values)
    dimensions_positive = dimensions_finite and all(float(value) > 0.0 for value in values)
    target_valid = math.isfinite(target_height_mm) and MIN_PRINT_HEIGHT_MM <= target_height_mm <= MAX_PRINT_HEIGHT_MM
    target_tolerance = max(0.01, abs(target_height_mm) * 0.001)
    target_matches = bool(
        dimensions_positive
        and target_valid
        and abs(float(dimensions["z"]) - target_height_mm) <= target_tolerance
    )

    vertex_count = int(metrics.get("vertex_count") or 0)
    finite_vertex_count = int(metrics.get("finite_vertex_count") or 0)
    triangle_count = int(metrics.get("triangle_count") or 0)
    non_manifold_edges = int(metrics.get("non_manifold_edges") or 0)
    degenerate_faces = int(metrics.get("degenerate_faces") or 0)
    component_count = int(metrics.get("component_count") or 0)
    format_error = str(metrics.get("format_error") or "").strip()

    checks = [
        _check("stl_format", not format_error, format_error or "binary STL structure is valid"),
        _check("physical_height_range", target_valid, f"requested height is {target_height_mm:g} mm"),
        _check("nonempty_geometry", vertex_count > 0 and triangle_count > 0, f"measured {vertex_count} vertices and {triangle_count} triangles"),
        _check("finite_vertices", vertex_count > 0 and finite_vertex_count == vertex_count, f"measured {finite_vertex_count}/{vertex_count} finite vertices"),
        _check("finite_positive_dimensions", dimensions_positive, f"measured dimensions {dimensions}"),
        _check("physical_height", target_matches, f"measured {values[2]} mm; expected {target_height_mm:g} +/- {target_tolerance:g} mm"),
        _check("watertight_manifold", non_manifold_edges == 0, f"measured {non_manifold_edges} open or non-manifold edges"),
        _check("nondegenerate_faces", degenerate_faces == 0, f"measured {degenerate_faces} degenerate triangles"),
        _check("single_connected_component", component_count == 1, f"measured {component_count} disconnected components"),
    ]
    issues = [item["detail"] for item in checks if not item["passed"]]
    return {"passed": not issues, "checks": checks, "issues": issues}


def format_repair_failure(validation: dict[str, Any]) -> str:
    """Create a bounded, actionable message safe to return through the API."""
    issues = [str(issue).rstrip(".") for issue in validation.get("issues") or []]
    detail = "; ".join(issues[:3]) or "the final manufacturing checks did not pass"
    return (
        f"Automatic mesh repair could not make this model printable: {detail}. "
        "Regenerate the model with one closed, connected solid or provide a repaired watertight mesh."
    )


def inspect_binary_stl(data: bytes, target_height_mm: float) -> dict[str, Any]:
    """Validate the exact exported STL artifact without trusting Blender state."""
    if len(data) < 84:
        metrics = _empty_metrics("STL is shorter than the 84-byte binary header")
        return {"metrics": metrics, "validation": validate_print_metrics(metrics, target_height_mm)}

    triangle_count = struct.unpack_from("<I", data, 80)[0]
    expected_size = 84 + triangle_count * 50
    if triangle_count == 0 or len(data) != expected_size:
        reason = (
            "STL contains no triangles"
            if triangle_count == 0
            else f"STL byte length is {len(data)}; expected {expected_size}"
        )
        metrics = _empty_metrics(reason)
        metrics["triangle_count"] = triangle_count
        return {"metrics": metrics, "validation": validate_print_metrics(metrics, target_height_mm)}

    vertices: dict[tuple[float, float, float], int] = {}
    finite_occurrences = 0
    degenerate_faces = 0
    edge_faces: dict[tuple[int, int], list[int]] = {}
    parents = list(range(triangle_count))
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]

    def find(item: int) -> int:
        while parents[item] != item:
            parents[item] = parents[parents[item]]
            item = parents[item]
        return item

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    invalid_coordinates = False
    for face_index in range(triangle_count):
        offset = 84 + face_index * 50
        unpacked = struct.unpack_from("<12fH", data, offset)
        face_vertices = [tuple(unpacked[index:index + 3]) for index in (3, 6, 9)]
        if not all(all(math.isfinite(value) for value in vertex) for vertex in face_vertices):
            invalid_coordinates = True
            continue

        finite_occurrences += 3
        vertex_ids = []
        for vertex in face_vertices:
            vertex_id = vertices.setdefault(vertex, len(vertices))
            vertex_ids.append(vertex_id)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], vertex[axis])
                maximum[axis] = max(maximum[axis], vertex[axis])

        ab = tuple(face_vertices[1][axis] - face_vertices[0][axis] for axis in range(3))
        ac = tuple(face_vertices[2][axis] - face_vertices[0][axis] for axis in range(3))
        cross = (
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        )
        if 0.5 * math.sqrt(sum(value * value for value in cross)) <= 1e-10:
            degenerate_faces += 1

        for left, right in ((vertex_ids[0], vertex_ids[1]), (vertex_ids[1], vertex_ids[2]), (vertex_ids[2], vertex_ids[0])):
            edge = (left, right) if left < right else (right, left)
            owners = edge_faces.setdefault(edge, [])
            if owners:
                union(face_index, owners[0])
            owners.append(face_index)

    if invalid_coordinates:
        vertex_count = triangle_count * 3
        finite_vertex_count = finite_occurrences
        dimensions = {"x": math.nan, "y": math.nan, "z": math.nan}
    else:
        vertex_count = len(vertices)
        finite_vertex_count = vertex_count
        dimensions = {
            axis: maximum[index] - minimum[index]
            for index, axis in enumerate(("x", "y", "z"))
        }

    non_manifold_edges = sum(1 for owners in edge_faces.values() if len(owners) != 2)
    component_count = len({find(index) for index in range(triangle_count)}) if not invalid_coordinates else triangle_count
    metrics = {
        "vertex_count": vertex_count,
        "finite_vertex_count": finite_vertex_count,
        "triangle_count": triangle_count,
        "non_manifold_edges": non_manifold_edges,
        "degenerate_faces": degenerate_faces,
        "component_count": component_count,
        "dimensions_mm": dimensions,
    }
    return {"metrics": metrics, "validation": validate_print_metrics(metrics, target_height_mm)}


def _empty_metrics(format_error: str) -> dict[str, Any]:
    return {
        "vertex_count": 0,
        "finite_vertex_count": 0,
        "triangle_count": 0,
        "non_manifold_edges": 0,
        "degenerate_faces": 0,
        "component_count": 0,
        "dimensions_mm": {"x": 0.0, "y": 0.0, "z": 0.0},
        "format_error": format_error,
    }
