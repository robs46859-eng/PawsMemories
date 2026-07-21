import React from "react";
import { FULL_WARDROBE_CATALOG, type WardrobeItem } from "./catalog";

/**
 * Wardrobe rendering layer for the Fido's Styles viewer.
 *
 * ⚠️ PLACEHOLDER GEOMETRY, deliberately quarantined in this module.
 *
 * These accessories are procedural approximations (torus collar, cone hat,
 * box cape…) because the real bone-attached GLB assets do not exist yet —
 * the sourcing decision (Sketchfab ingest vs. Quaternius pack vs. authored
 * in-house) is open item #7 in IMPLEMENTATION_SPEC.md §11.
 *
 * When real assets land (WARDROBE_WAGS_AND_TEXTURIZER_SPEC.md §1.0 —
 * skeletal bone attachment with auto-fit scaling), this module is replaced
 * wholesale: same `<WardrobeLayer selectedIds>` contract, GLB loading +
 * skeleton attachment inside. Nothing else in the viewer changes. Keeping
 * every placeholder mesh here (and none in FidosStylesScreen) makes the
 * remaining fake geometry auditable at a glance.
 */

/** Procedural fallback until a real bone-attached GLB is provided. */
function WardrobeAccessory({ item }: { item: WardrobeItem }) {
  const [x, y, z] = item.anchorMeters;
  const mat = (
    <meshStandardMaterial
      color={item.color}
      roughness={0.72}
      metalness={item.id.includes("gold") ? 0.55 : 0.04}
    />
  );
  if (item.kind === "neck") {
    return (
      <group position={[x, y, z]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          {item.id.includes("medallion")
            ? <sphereGeometry args={[0.09, 24, 18]} />
            : <torusGeometry args={[0.19, 0.025, 12, 48]} />}
          {mat}
        </mesh>
      </group>
    );
  }
  if (item.kind === "head") {
    return (
      <group position={[x, y, z]}>
        <mesh>
          {item.id.includes("crown")
            ? <cylinderGeometry args={[0.16, 0.22, 0.24, 6]} />
            : <coneGeometry args={[item.id.includes("wizard") ? 0.23 : 0.17, item.id.includes("wizard") ? 0.52 : 0.34, 28]} />}
          {mat}
        </mesh>
      </group>
    );
  }
  if (item.kind === "face") {
    return (
      <group position={[x, y, z]}>
        <mesh position={[-0.11, 0, 0]}><torusGeometry args={[0.09, 0.012, 10, 32]} />{mat}</mesh>
        <mesh position={[0.11, 0, 0]}><torusGeometry args={[0.09, 0.012, 10, 32]} />{mat}</mesh>
        <mesh><boxGeometry args={[0.08, 0.018, 0.018]} />{mat}</mesh>
      </group>
    );
  }
  if (item.kind === "back") {
    return (
      <mesh position={[x, y, z]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[0.54, 0.68, 0.035]} />{mat}
      </mesh>
    );
  }
  return (
    <mesh position={[x, y, z]}>
      <sphereGeometry args={[0.34, 28, 20]} />{mat}
    </mesh>
  );
}

export function WardrobeLayer({ selectedIds }: { selectedIds: string[] }) {
  return (
    <group>
      {FULL_WARDROBE_CATALOG
        .filter((item) => selectedIds.includes(item.id))
        .map((item) => <WardrobeAccessory key={item.id} item={item} />)}
    </group>
  );
}
