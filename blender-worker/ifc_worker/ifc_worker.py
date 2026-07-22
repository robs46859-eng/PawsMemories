"""Fail-closed IFC conversion, inspection, and constrained BIM authoring."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import struct
import sys
import time
from pathlib import Path
from typing import Any

SUPPORTED_SCHEMAS = {"IFC2X3", "IFC4", "IFC4X3"}
MAX_FILE_BYTES = int(os.environ.get("IFC_WORKER_MAX_MB", "50")) * 1024 * 1024
TIMEOUT = int(os.environ.get("IFC_WORKER_TIMEOUT", "120"))
MAX_ELEMENTS = int(os.environ.get("IFC_WORKER_MAX_ELEMENTS", "100000"))


class WorkerError(RuntimeError):
    pass


def compute_source_hash(filepath: str) -> str:
    digest = hashlib.sha256()
    with open(filepath, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_file(path: str, suffix: str, max_bytes: int = MAX_FILE_BYTES) -> Path:
    resolved = Path(path).resolve()
    if resolved.suffix.lower() != suffix:
        raise WorkerError(f"Expected a {suffix} file")
    if not resolved.is_file():
        raise WorkerError(f"Input file not found: {resolved}")
    size = resolved.stat().st_size
    if size <= 0 or size > max_bytes:
        raise WorkerError(f"Input size {size} is outside the allowed range")
    return resolved


def _validate_step_signature(path: Path) -> None:
    with path.open("rb") as source:
        if b"ISO-10303-21;" not in source.read(128).upper():
            raise WorkerError("Not a valid IFC STEP file")


def validate_schema(ifc_file: Any) -> str:
    schema = str(getattr(ifc_file, "schema", "") or "").upper().replace("-", "")
    if schema not in SUPPORTED_SCHEMAS:
        raise WorkerError(f"Unsupported IFC schema: {schema or 'unknown'}")
    return schema


def get_unit_name(ifc_file: Any) -> tuple[str, float]:
    import ifcopenshell.util.unit

    scale = float(ifcopenshell.util.unit.calculate_unit_scale(ifc_file))
    if not math.isfinite(scale) or scale <= 0:
        raise WorkerError("IFC length-unit scale is invalid")
    known = {
        1.0: "m",
        0.01: "cm",
        0.001: "mm",
        0.3048: "ft",
        0.0254: "in",
        1000.0: "km",
    }
    for factor, label in known.items():
        if math.isclose(scale, factor, rel_tol=1e-9, abs_tol=1e-12):
            return label, scale
    return "custom", scale


def _quantity_factor(name: str, linear_scale: float) -> float:
    lowered = name.lower()
    if "volume" in lowered:
        return linear_scale ** 3
    if "area" in lowered:
        return linear_scale ** 2
    return linear_scale


def _clean_psets(raw: dict[str, Any], unit_scale: float) -> tuple[dict[str, Any], dict[str, Any]]:
    properties: dict[str, Any] = {}
    quantities: dict[str, Any] = {}
    for set_name, values in raw.items():
        if not isinstance(values, dict):
            continue
        target = quantities if set_name.lower().startswith("qto_") else properties
        cleaned: dict[str, Any] = {}
        for key, value in values.items():
            if key == "id":
                continue
            if target is quantities and isinstance(value, (int, float)):
                cleaned[key] = value * _quantity_factor(key, unit_scale)
            elif isinstance(value, (str, int, float, bool)) or value is None:
                cleaned[key] = value
            else:
                cleaned[key] = str(value)
        target[set_name] = cleaned
    return properties, quantities


def _repair_ifcopenshell_glb(path: Path) -> None:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise WorkerError("IFC serializer did not produce GLB data")
    version, _ = struct.unpack_from("<II", data, 4)
    if version != 2:
        raise WorkerError(f"Unsupported GLB version: {version}")
    offset = 12
    chunks: list[tuple[int, bytes]] = []
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        payload = data[offset:offset + length]
        if len(payload) != length:
            raise WorkerError("Truncated GLB chunk")
        chunks.append((kind, payload))
        offset += length
    if not chunks or chunks[0][0] != 0x4E4F534A:
        raise WorkerError("Missing required GLB JSON chunk")
    document = json.loads(chunks[0][1].rstrip(b" \t\r\n\x00"))
    document.setdefault("asset", {"version": "2.0", "generator": "IfcOpenShell"})
    document["asset"]["version"] = "2.0"
    if document.get("scenes") and "scene" not in document:
        document["scene"] = 0
    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    rebuilt = [(0x4E4F534A, encoded), *chunks[1:]]
    total = 12 + sum(8 + len(payload) for _, payload in rebuilt)
    output = bytearray(b"glTF" + struct.pack("<II", 2, total))
    for kind, payload in rebuilt:
        output += struct.pack("<II", len(payload), kind) + payload
    path.write_bytes(output)


def validate_glb(path: str) -> dict[str, Any]:
    target = _require_file(path, ".glb", max_bytes=500 * 1024 * 1024)
    data = target.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise WorkerError("Output is not a GLB")
    total = struct.unpack_from("<I", data, 8)[0]
    if total != len(data):
        raise WorkerError("GLB declared length does not match file length")
    json_length, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A:
        raise WorkerError("GLB is missing its JSON chunk")
    document = json.loads(data[20:20 + json_length].rstrip(b" \t\r\n\x00"))
    if document.get("asset", {}).get("version") != "2.0":
        raise WorkerError("GLB asset.version must be 2.0")
    return document


def inspect_ifc(path: str) -> tuple[Any, dict[str, Any]]:
    import ifcopenshell
    import ifcopenshell.util.element
    import ifcopenshell.util.placement

    source = _require_file(path, ".ifc")
    _validate_step_signature(source)
    try:
        model = ifcopenshell.open(str(source))
    except Exception as exc:
        raise WorkerError(f"Could not parse IFC: {exc}") from exc
    schema = validate_schema(model)
    unit, unit_scale = get_unit_name(model)
    # Spaces are spatial elements rather than IfcElement, but remain first-class
    # selectable BIM semantics in the browser sidecar.
    elements = [*model.by_type("IfcElement"), *model.by_type("IfcSpace")]
    if len(elements) > MAX_ELEMENTS:
        raise WorkerError(f"IFC has {len(elements)} elements; limit is {MAX_ELEMENTS}")
    sidecar_elements: list[dict[str, Any]] = []
    by_class: dict[str, int] = {}
    for element in elements:
        global_id = str(getattr(element, "GlobalId", "") or "")
        if not global_id:
            raise WorkerError(f"{element.is_a()} #{element.id()} has no GlobalId")
        by_class[element.is_a()] = by_class.get(element.is_a(), 0) + 1
        container = ifcopenshell.util.element.get_container(element)
        matrix = ifcopenshell.util.placement.get_local_placement(element.ObjectPlacement) if getattr(element, "ObjectPlacement", None) else None
        placement = [float(matrix[i, 3]) * unit_scale for i in range(3)] if matrix is not None else [0.0, 0.0, 0.0]
        psets = ifcopenshell.util.element.get_psets(element, psets_only=False, qtos_only=False)
        properties, quantities = _clean_psets(psets, unit_scale)
        material = ifcopenshell.util.element.get_material(element)
        sidecar_elements.append({
            "globalId": global_id,
            "class": element.is_a(),
            "name": str(getattr(element, "Name", "") or ""),
            "description": str(getattr(element, "Description", "") or ""),
            "parentGlobalId": str(getattr(container, "GlobalId", "") or "") if container else "",
            "storeyName": str(getattr(container, "Name", "") or "") if container and container.is_a("IfcBuildingStorey") else "",
            "placement": placement,
            "properties": properties,
            "quantities": quantities,
            "materials": [str(getattr(material, "Name", "") or "")] if material else [],
            "classification": "",
            "hasGeometry": False,
            "warning": "",
        })
    projects = model.by_type("IfcProject")
    sites = model.by_type("IfcSite")
    buildings = model.by_type("IfcBuilding")
    storeys = model.by_type("IfcBuildingStorey")
    result = {
        "success": True,
        "schema": schema,
        "sourceUnit": unit,
        "metersPerUnit": unit_scale,
        "projectName": str(getattr(projects[0], "Name", "") or "") if projects else "",
        "siteName": str(getattr(sites[0], "Name", "") or "") if sites else "",
        "buildingName": str(getattr(buildings[0], "Name", "") or "") if buildings else "",
        "storeys": [{
            "globalId": str(getattr(item, "GlobalId", "") or ""),
            "name": str(getattr(item, "Name", "") or ""),
            "elevation": float(getattr(item, "Elevation", 0) or 0) * unit_scale,
        } for item in storeys],
        "elements": sidecar_elements,
        "elementCount": len(elements),
        "entitiesByClass": by_class,
        "proxyCount": len(model.by_type("IfcBuildingElementProxy")),
        "globalIdCount": sum(1 for item in sidecar_elements if item["globalId"]),
        "uniqueGlobalIdCount": len({item["globalId"] for item in sidecar_elements if item["globalId"]}),
        "relationshipCount": sum(1 for item in sidecar_elements if item["parentGlobalId"]),
        "voidRelationshipCount": len(model.by_type("IfcRelVoidsElement")),
        "fillingRelationshipCount": len(model.by_type("IfcRelFillsElement")),
        "propertySetElementCount": sum(1 for item in sidecar_elements if item["properties"]),
        "storeyCount": len(storeys),
        "coordinateReference": str(getattr(((model.by_type("IfcProjectedCRS") if schema != "IFC2X3" else []) or [None])[0], "Name", "") or ""),
        "placementsFinite": all(all(math.isfinite(value) for value in item["placement"]) for item in sidecar_elements),
        "roundTripPassed": False,
        "sourceHash": compute_source_hash(str(source)),
        "fileSizeBytes": source.stat().st_size,
        "converterVersion": "1.0.0",
    }
    return model, result


def convert_ifc(input_path: str, output_path: str, sidecar_path: str | None = None) -> dict[str, Any]:
    import ifcopenshell.geom

    started = time.monotonic()
    model, report = inspect_ifc(input_path)
    output = Path(output_path).resolve()
    if output.suffix.lower() != ".glb":
        raise WorkerError("Output must use .glb")
    output.parent.mkdir(parents=True, exist_ok=True)
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    serializer_settings = ifcopenshell.geom.serializer_settings()
    serializer_settings.set("use-element-guids", True)
    serializer = ifcopenshell.geom.serializers.gltf(str(output), settings, serializer_settings)
    iterator = ifcopenshell.geom.iterator(settings, model, max(1, min(os.cpu_count() or 1, 8)))
    if not iterator.initialize():
        raise WorkerError("IFC contains no convertible geometry")
    converted: set[str] = set()
    failures: list[dict[str, str]] = []
    while True:
        if time.monotonic() - started > TIMEOUT:
            raise WorkerError(f"IFC conversion exceeded {TIMEOUT} seconds")
        shape = iterator.get()
        guid = str(shape.guid)
        try:
            serializer.write(shape)
            converted.add(guid)
        except Exception as exc:
            failures.append({"globalId": guid, "error": str(exc)})
        if not iterator.next():
            break
    serializer.finalize()
    del serializer
    gc.collect()
    if failures:
        raise WorkerError(f"{len(failures)} IFC elements failed geometry conversion")
    _repair_ifcopenshell_glb(output)
    document = validate_glb(str(output))
    if not document.get("meshes"):
        raise WorkerError("Converted GLB contains no meshes")
    position_accessors = [item for item in document.get("accessors", []) if item.get("type") == "VEC3" and "min" in item and "max" in item]
    if not position_accessors:
        raise WorkerError("Converted GLB has no bounded position accessors")
    glb_min = [min(item["min"][axis] for item in position_accessors) for axis in range(3)]
    glb_max = [max(item["max"][axis] for item in position_accessors) for axis in range(3)]
    for element in report["elements"]:
        element["hasGeometry"] = element["globalId"] in converted
        if not element["hasGeometry"]:
            element["warning"] = "Element has no rendered geometry"
    report.update({
        "outputPath": str(output),
        "durationSec": time.monotonic() - started,
        "geometryFailures": [],
        "warnings": [],
        "glbBounds": {"min": glb_min, "max": glb_max, "dimensions": [glb_max[i] - glb_min[i] for i in range(3)]},
    })
    if sidecar_path:
        sidecar = Path(sidecar_path).resolve()
        sidecar.parent.mkdir(parents=True, exist_ok=True)
        sidecar.write_text(json.dumps(report, indent=2), encoding="utf-8")
        report["sidecarPath"] = str(sidecar)
    return report


def _box_geometry(model: Any, body: Any, product: Any, x: float, y: float, z: float, width: float, depth: float, height: float) -> None:
    import ifcopenshell.api.geometry
    import numpy as np

    vertices = [[
        (0, 0, 0), (width, 0, 0), (width, depth, 0), (0, depth, 0),
        (0, 0, height), (width, 0, height), (width, depth, height), (0, depth, height),
    ]]
    faces = [[
        (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
        (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
    ]]
    # Let IfcOpenShell derive the project's unit scale. Passing 1 here treats SI
    # dimensions as project units (for example 0.2 mm instead of 0.2 m).
    representation = ifcopenshell.api.geometry.add_mesh_representation(model, context=body, vertices=vertices, faces=faces)
    ifcopenshell.api.geometry.assign_representation(model, product=product, representation=representation)
    matrix = np.eye(4)
    matrix[:3, 3] = [x, y, z]
    ifcopenshell.api.geometry.edit_object_placement(model, product=product, matrix=matrix, is_si=True)


def export_bim(json_path: str, output_path: str) -> dict[str, Any]:
    import ifcopenshell.api.aggregate
    import ifcopenshell.api.context
    import ifcopenshell.api.feature
    import ifcopenshell.api.georeference
    import ifcopenshell.api.geometry
    import ifcopenshell.api.project
    import ifcopenshell.api.pset
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial
    import ifcopenshell.api.unit

    source = _require_file(json_path, ".json", max_bytes=10 * 1024 * 1024)
    payload = json.loads(source.read_text(encoding="utf-8"))
    levels = payload.get("levels")
    elements = payload.get("elements")
    if not isinstance(levels, list) or not levels or not isinstance(elements, list):
        raise WorkerError("BIM JSON requires non-empty levels and an elements array")
    if len(elements) > 10000:
        raise WorkerError("BIM authoring export is limited to 10,000 elements")
    model = ifcopenshell.api.project.create_file("IFC4")
    project = ifcopenshell.api.root.create_entity(model, ifc_class="IfcProject", name=str(payload.get("name") or "Pawsome3D Project"))
    ifcopenshell.api.unit.assign_unit(model)
    model_context = ifcopenshell.api.context.add_context(model, context_type="Model")
    body = ifcopenshell.api.context.add_context(model, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=model_context)
    coordinate_reference = str(payload.get("coordinateReference") or "").strip()
    if coordinate_reference:
        ifcopenshell.api.georeference.add_georeferencing(model, name=coordinate_reference)
    site = ifcopenshell.api.root.create_entity(model, ifc_class="IfcSite", name=str(payload.get("siteName") or "Site"))
    building = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuilding", name=str(payload.get("buildingName") or "Building"))
    ifcopenshell.api.aggregate.assign_object(model, products=[site], relating_object=project)
    ifcopenshell.api.aggregate.assign_object(model, products=[building], relating_object=site)
    level_map: dict[str, Any] = {}
    for level in levels:
        storey = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuildingStorey", name=str(level.get("name") or "Level"))
        storey.Elevation = float(level.get("elevation", 0))
        ifcopenshell.api.aggregate.assign_object(model, products=[storey], relating_object=building)
        level_map[str(level["id"])] = storey
    product_map: dict[str, Any] = {}
    class_map = {
        "wall": "IfcWall", "slab": "IfcSlab", "roof": "IfcRoof",
        "opening": "IfcOpeningElement", "door": "IfcDoor", "window": "IfcWindow",
        "space": "IfcSpace", "column": "IfcColumn", "beam": "IfcBeam",
    }
    for item in elements:
        kind = str(item.get("type") or "")
        if kind not in class_map:
            raise WorkerError(f"Unsupported BIM element type: {kind}")
        product = ifcopenshell.api.root.create_entity(model, ifc_class=class_map[kind], name=str(item.get("name") or kind.title()))
        if item.get("globalId"):
            product.GlobalId = str(item["globalId"])
        storey = level_map.get(str(item.get("levelId")))
        if storey:
            if product.is_a("IfcSpatialElement"):
                ifcopenshell.api.aggregate.assign_object(model, products=[product], relating_object=storey)
            else:
                ifcopenshell.api.spatial.assign_container(model, products=[product], relating_structure=storey)
        x, y, z = [float(v) for v in item.get("position", [0, 0, 0])]
        if kind == "wall":
            end = item.get("end", [x + float(item.get("length", 1)), y])
            representation = ifcopenshell.api.geometry.create_2pt_wall(
                model, element=product, context=body, p1=(x, y), p2=(float(end[0]), float(end[1])),
                elevation=z, height=float(item.get("height", 3)), thickness=float(item.get("thickness", 0.2)), is_si=True,
            )
            ifcopenshell.api.geometry.assign_representation(model, product=product, representation=representation)
        else:
            _box_geometry(
                model, body, product, x, y, z,
                max(float(item.get("width", 1)), 0.001),
                max(float(item.get("depth", item.get("thickness", 0.2))), 0.001),
                max(float(item.get("height", item.get("thickness", 0.2))), 0.001),
            )
        properties = dict(item.get("properties") or {})
        properties["Pawsome3DId"] = str(item.get("id") or "")
        pset = ifcopenshell.api.pset.add_pset(model, product=product, name="Pset_Pawsome3D")
        ifcopenshell.api.pset.edit_pset(model, pset=pset, properties=properties)
        product_map[str(item.get("id"))] = product
    for item in elements:
        product = product_map.get(str(item.get("id")))
        host = product_map.get(str(item.get("hostId")))
        opening = product_map.get(str(item.get("openingId")))
        if item.get("type") == "opening" and product and host:
            ifcopenshell.api.feature.add_feature(model, feature=product, element=host)
        if item.get("type") in {"door", "window"} and product and opening:
            ifcopenshell.api.feature.add_filling(model, opening=opening, element=product)
    output = Path(output_path).resolve()
    if output.suffix.lower() != ".ifc":
        raise WorkerError("Export path must use .ifc")
    output.parent.mkdir(parents=True, exist_ok=True)
    model.write(str(output))
    reopened, report = inspect_ifc(str(output))
    del reopened
    report["roundTripPassed"] = True
    report["outputPath"] = str(output)
    report["exportedElementCount"] = len(elements)
    return report


def _run(args: argparse.Namespace) -> dict[str, Any]:
    if args.command == "inspect":
        _, result = inspect_ifc(args.input)
        return result
    if args.command == "convert":
        return convert_ifc(args.input, args.output, args.dump_sidecar)
    if args.command == "export":
        return export_bim(args.input, args.output)
    if args.command == "validate-glb":
        return {"success": True, "document": validate_glb(args.input)}
    raise WorkerError("Unknown command")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    inspect_parser = sub.add_parser("inspect")
    inspect_parser.add_argument("input")
    convert_parser = sub.add_parser("convert")
    convert_parser.add_argument("input")
    convert_parser.add_argument("output")
    convert_parser.add_argument("--dump-sidecar")
    export_parser = sub.add_parser("export")
    export_parser.add_argument("input")
    export_parser.add_argument("output")
    validate_parser = sub.add_parser("validate-glb")
    validate_parser.add_argument("input")
    args = parser.parse_args()
    try:
        print(json.dumps(_run(args)))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
