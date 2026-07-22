# Antigravity Prompt: Execute Phase 4, Then Phase 5

Work in `/Users/robert/Desktop/claude7126/PawsMemories` from the current dirty worktree. Preserve all lead Phase 3 corrections. Do not commit, push, begin Phase 6, or include unrelated `scripts/add_visemes.py` work.

Read `AGENTS.md`, `SKILLS.md`, `BUILD_EXECUTION_SCAFFOLD.md`, `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`, `PHASED_IMPLEMENTATION.md`, `HANDOFF.md`, all Phase 1-3 evidence, `skills/animator/{RIGGING,LIPSYNC,MESHOPS}.md`, and `/Users/robert/.codex/skills/image-to-3d/SKILL.md`. Audit current animator, accessory, asset-registry, Fur Bin, marketplace, model-build, migrations, and tests before editing.

## Baseline

Record the start commit and dirty inventory. Run Node 24 TypeScript, Phase 1-3 tests, full tests, build, animator doctor, and whitespace. Read `CURRENT_SCHEMA_VERSION`; never edit released migrations. Create and continuously update `phase-evidence/PHASE_4.md`, `PHASE_4_CHECKLIST.html`, `PHASE_5.md`, and `PHASE_5_CHECKLIST.html`. Both phases need separate server-authoritative default-off flags.

## Fast-Track Orchestration

Use parallel subagents where supported, with one lead integrating results. Assign disjoint write sets:

- **P4-A Contract/Persistence:** migrations, schemas, repository, service state machine, authorization, idempotency, lineage.
- **P4-B Worker/Validation:** Blender boundary, rig/facial/accessory validation, fixtures, recovery, compensation cleanup.
- **P4-C Product UI:** typed client, authenticated screens, viewer, accessibility, responsive light/dark states. Build against frozen DTOs and typed fakes until integration.
- **P4-D Adversarial/Evidence:** tests, browser matrix, evidence/checklists; do not edit production modules except test hooks approved by the lead.

Freeze shared schemas and DTOs before parallel implementation. Do not let two agents edit the same file. Run lane-focused tests during development, combined Phase 1-4 tests at integration, and the full suite/build/doctor once for the Phase 4 exit candidate. While Phase 4 runs, a Phase 5 discovery agent may produce a read-only gap map and fixture/test plan, but it may not change Phase 5 production code or migrations before the Phase 4 code gate.

## Phase 4: Rig, Facial, Accessories

Build a durable canonical derivative pipeline consuming only an owner-authorized, accepted Phase 3 asset/version.

1. Persist deterministic `biped`, `quadruped`, or `unsupported` classification, classifier version/evidence/confidence, override audit, and selected profile.
2. Add idempotent rig jobs/attempts with leases, restart recovery, worker handles, bounded retries, immutable inputs/outputs, failure codes, and compensation cleanup.
3. Validate named bones/hierarchy, bind matrices, bone indices, finite transforms, nonzero weights, no unweighted islands, maximum four influences, animation/deformation sweep, silhouette/penetration, and mobile joint/triangle/texture budgets.
4. Separately inventory actual facial morphs, canonical viseme coverage, blink, jaw, eye controls, and deformation. Persist only measured `full`, `partial`, `body_only`, or `unsupported`. Morph-name mapping is not facial authoring. Route missing geometry to a real configured authoring job or degrade honestly.
5. Register rigged GLB, manifests, clips, facial artifacts, and deformation renders as immutable private canonical versions with lineage from the accepted model.
6. Replace preview-only accessory assumptions with immutable accessory GLBs carrying owner/license, compatible profiles, attachment bone, fit bounds, collision bounds, export policy, and previews.
7. Fitting creates a derivative and measures missing attachment, floating distance, penetration, animation sweep, polygon budget, and print clearance. Export a GLB that reopens with rig, weights, animations, facial targets, materials, and accessories preserved. Print output must be fused and revalidated separately.
8. Add authenticated UI for progress, measured capability badges/disclosures, body-only fallback, accessory fit preview, retry, and explicit derivative acceptance using existing Three.js/theme systems.

Fixtures must include representative human, quadruped, unsupported/static, multi-mesh, rigid parts, tail, long ears, digitigrade legs, missing face, malformed weights, excessive influences, and at least ten mesh variations. Test authorization, concurrency, restart, malformed output, cleanup, lineage, badge honesty, facial fallback, accessory fit/export reopen, and mobile budgets.

Do not begin Phase 5 until Phase 4 focused tests have zero skips, all fixtures have measured manifests, earlier regressions pass, browser light/dark at 320/360/390/430px and desktop passes, and live Blender evidence exists or is explicitly recorded as an external blocker. Never replace live evidence with fixtures.

## Phase 5: Fur Bin Library and Showcase

After the Phase 4 code gate, replace legacy union-based Fur Bin truth with owner-scoped canonical assets/versions. Keep legacy compatibility behind an explicit adapter.

1. Implement private search, tags, collections, covers, immutable history, current-version selection/rollback, lineage, measured badges, dimensions, animations, accessories/derivatives, and exact storage totals.
2. Signed viewing URLs are short-lived, owner-authorized, regenerated after expiry, and never persisted or logged.
3. Publishing creates a separate showcase record containing only the selected public derivative, cover, title, description, tags, category, attribution, rights, and moderation state. Unpublish never deletes private sources.
4. Enforce rights/commercial eligibility. Marketplace listings bind immutable deliverable versions and cannot follow mutable current pointers.
5. Add fail-closed moderation transitions and admin audit history.
6. Add responsive private-library/public-showcase UI with GPU/memory degradation, static-render fallback, keyboard controls, reduced motion, and accessible non-3D details.
7. Test owner isolation, guessed UUIDs, private/public boundaries, stale URLs, publish races, unpublish, moderation, immutable purchases, rollback, exact storage totals, concurrent registration/deletion compensation, accessibility, and mobile degradation.

## Gates and Stop

After each phase run `git diff --check`, `npm run lint`, all earlier focused tests, new focused tests with zero skips, `npm run test` under Node 24.18, `npm run build`, and `npm run animator:doctor`. Save browser evidence. Keep unavailable live services marked `BLOCKED`, never passed.

Stop before commit. Report Phase 4 and Phase 5 separately: changed files, migrations, exact totals, fixtures, screenshots, live-worker evidence/blockers, security/privacy findings, residual risks, and honest signoff decision. Do not collapse scaffold presence into completion.
