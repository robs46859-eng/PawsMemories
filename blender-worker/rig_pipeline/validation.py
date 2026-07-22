"""Pure measurement helpers for the Phase 4 Blender rig pipeline."""

from __future__ import annotations

import math
from typing import Iterable, Mapping, Sequence


CANONICAL_VISEMES = tuple("ABCDEFGH") + ("X",)
FULL_FACIAL_SET = CANONICAL_VISEMES + ("jawOpen", "eyeBlinkLeft", "eyeBlinkRight")

_ALIASES = {
    "a": "A",
    "visemea": "A",
    "viseme_a": "A",
    "b": "B",
    "visemeb": "B",
    "viseme_b": "B",
    "c": "C",
    "visemec": "C",
    "viseme_c": "C",
    "d": "D",
    "visemed": "D",
    "viseme_d": "D",
    "e": "E",
    "visemee": "E",
    "viseme_e": "E",
    "f": "F",
    "visemef": "F",
    "viseme_f": "F",
    "g": "G",
    "visemeg": "G",
    "viseme_g": "G",
    "h": "H",
    "visemeh": "H",
    "viseme_h": "H",
    "x": "X",
    "visemex": "X",
    "viseme_x": "X",
    "jawopen": "jawOpen",
    "jaw_open": "jawOpen",
    "blinkleft": "eyeBlinkLeft",
    "blink_left": "eyeBlinkLeft",
    "eyeblinkleft": "eyeBlinkLeft",
    "blinkright": "eyeBlinkRight",
    "blink_right": "eyeBlinkRight",
    "eyeblinkright": "eyeBlinkRight",
}


def canonical_target_name(name: str) -> str | None:
    """Map known aliases without mutating the source target name."""
    normalized = "".join(ch for ch in str(name).strip() if ch.isalnum() or ch == "_").lower()
    return _ALIASES.get(normalized)


def measure_morph(
    basis: Sequence[Sequence[float]],
    target: Sequence[Sequence[float]],
    allowed_region: Iterable[int],
    head_size: float,
    *,
    epsilon_ratio: float = 1e-6,
    locality_min: float = 0.85,
    displacement_ratio_max: float = 0.25,
) -> dict:
    """Measure non-empty, finite, localized and bounded morph deformation."""
    if len(basis) != len(target) or not basis:
        return {
            "displacedVertices": 0,
            "maxDisplacement": 0.0,
            "locality": 0.0,
            "finite": False,
            "localityPass": False,
            "deformationPass": False,
            "pass": False,
        }

    credible_size = float(head_size)
    if not math.isfinite(credible_size) or credible_size <= 0:
        credible_size = 0.0
    epsilon = max(credible_size * epsilon_ratio, 1e-9)
    allowed = set(int(index) for index in allowed_region)
    displaced = 0
    local = 0
    maximum = 0.0
    finite = True

    for index, (source, destination) in enumerate(zip(basis, target)):
        if len(source) != 3 or len(destination) != 3:
            finite = False
            break
        delta = [float(destination[axis]) - float(source[axis]) for axis in range(3)]
        if not all(math.isfinite(component) for component in delta):
            finite = False
            break
        distance = math.sqrt(sum(component * component for component in delta))
        maximum = max(maximum, distance)
        if distance > epsilon:
            displaced += 1
            if index in allowed:
                local += 1

    locality = local / displaced if displaced else 0.0
    deformation_pass = (
        finite
        and credible_size > 0
        and displaced > 0
        and maximum <= credible_size * displacement_ratio_max
    )
    locality_pass = bool(allowed) and locality >= locality_min
    return {
        "displacedVertices": displaced,
        "maxDisplacement": maximum,
        "locality": locality,
        "finite": finite,
        "localityPass": locality_pass,
        "deformationPass": deformation_pass,
        "pass": deformation_pass and locality_pass,
    }


def facial_capability(targets: Sequence[Mapping], requested: Sequence[str]) -> str:
    """Return capability only from target measurements that actually passed."""
    passing = {str(target.get("canonicalName")) for target in targets if target.get("pass") is True}
    if not passing:
        return "body_only"
    required = set(requested) if requested else set(FULL_FACIAL_SET)
    if set(FULL_FACIAL_SET).issubset(passing) and required.issubset(passing):
        return "full"
    return "partial"


def quaternion_xyzw(quaternion) -> list[float]:
    """Serialize Blender's (w, x, y, z) properties for the Three.js contract."""
    return [float(quaternion.x), float(quaternion.y), float(quaternion.z), float(quaternion.w)]


def print_metrics_pass(metrics: Mapping, max_triangles: int) -> bool:
    """Accept print-ready status only for one finite, connected, watertight mesh."""
    try:
        return (
            int(metrics.get("objectCount")) == 1
            and int(metrics.get("connectedComponents")) == 1
            and int(metrics.get("nonManifoldEdges")) == 0
            and metrics.get("finiteGeometry") is True
            and 0 < int(metrics.get("triangleCount")) <= int(max_triangles)
            and math.isfinite(float(metrics.get("volumeCubicMeters")))
            and float(metrics.get("volumeCubicMeters")) > 1e-12
        )
    except (TypeError, ValueError):
        return False
