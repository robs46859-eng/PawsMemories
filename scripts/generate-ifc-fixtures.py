"""Generate IFC fixtures with IfcOpenShell APIs instead of handwritten STEP."""
from __future__ import annotations
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "blender-worker" / "ifc_worker"))
from ifc_worker import export_bim  # noqa: E402

FIXTURES = ROOT / "fixtures"

def main() -> None:
    FIXTURES.mkdir(exist_ok=True)
    source = FIXTURES / "two-room-building.json"
    model = json.loads(source.read_text(encoding="utf-8"))
    export_bim(str(source), str(FIXTURES / "small-building.ifc"))
    rotated = json.loads(json.dumps(model))
    rotated["name"] = "Rotated acceptance building"
    for element in rotated["elements"]:
        x, y, z = element.get("position", [0, 0, 0])
        element["position"] = [-y + 100, x + 200, z]
        if "end" in element:
            ex, ey = element["end"]
            element["end"] = [-ey + 100, ex + 200]
    rotated_path = FIXTURES / "rotated-building.json"
    rotated_path.write_text(json.dumps(rotated, indent=2), encoding="utf-8")
    export_bim(str(rotated_path), str(FIXTURES / "rotated-building.ifc"))
    (FIXTURES / "malformed-building.ifc").write_text("not an IFC file\n", encoding="utf-8")
    (FIXTURES / "unsupported-schema.ifc").write_text("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC5'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n", encoding="utf-8")
    manifest = {"generatedBy": "scripts/generate-ifc-fixtures.py", "fixtures": [
        {"path": "small-building.ifc", "schema": "IFC4", "units": "m", "expectedToFail": False},
        {"path": "rotated-building.ifc", "schema": "IFC4", "units": "m", "expectedToFail": False},
        {"path": "malformed-building.ifc", "expectedToFail": True},
        {"path": "unsupported-schema.ifc", "schema": "IFC5", "expectedToFail": True}]}
    (FIXTURES / "ifc-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
