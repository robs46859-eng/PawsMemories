# FSAI Extraction — Agent Kickoff Prompt

Copy everything below the line into a fresh agent session (Claude Code or equivalent) started in `/Users/robert/Desktop/claude7126/`.

---

You are building **FSAI**, a standalone 3D modeling platform for architects, engineers, game designers, and urban development, deployed to fsai.pro. You are starting the extraction now.

## Authoritative inputs (local paths)

1. **Specification (binding):** `./PawsMemories/FSAI_ARCHITECTURE_SPEC.md` — read it in full before writing any code. §0 is your build directive: locked tech stack, repo layout, milestone order M0–M8 with acceptance gates, and prohibitions. §8 is the complete API surface (48 endpoints) — build nothing beyond it. Appendix A is your file-by-file extraction map.
2. **Context:** `./PawsMemories/FSAI_MIGRATION_PLAN.md` (phasing rationale) and `./PawsMemories/DEPLOYMENT_REVIEW_2026-07-19.md` (state of the source system).
3. **Source repository (READ-ONLY):** `./PawsMemories/` — the PawsMemories/Pawsome3D production codebase. You may read any file. You must never write, move, or delete anything inside it.

## Your task

1. Create the new repo at `./fsai/` with the exact layout from spec §0.3, including `DECISIONS.md`.
2. Execute milestones **M0 through M3** of spec §0.4, in order, using Appendix A to copy/port/rewrite source files:
   - M0: scaffold, CI workflow (`.github/workflows/deploy.yml` per §3 — build/test only until Hostinger secrets exist; leave deploy jobs implemented but gated on secret presence), `/api/health` running locally.
   - M1: auth + users + credits ledger (endpoints #1–#9) with contract tests.
   - M2: worker service with the existing bridge methods ported; `/api/health/worker` green against a locally running worker (Docker).
   - M3: **ifc_worker v2** implementing spec §5 (FR-BIM-1 through FR-BIM-9) and import endpoints #14–#20. This is the core deliverable: the parse audit must account for every `IfcProduct` in the file — zero silent drops. Test against at least one full-MEP IFC and one IFC4x3 civil file (download buildingSMART sample files into `fsai/worker/tests/fixtures/`; record each file's license in the fixture folder).
3. Stop after M3 and produce `fsai/M3_REPORT.md`: what was ported from where, audit results per fixture (bucket sums vs. file product counts), test status, and any `DECISIONS.md` entries made.

## Rules

- Where the spec is silent, choose the simplest option satisfying §8 and log it in `DECISIONS.md`. Do not invent endpoints, screens, or features.
- One IFC parser only (worker-side IfcOpenShell). The browser never parses IFC.
- No pet-domain code, names, or copy in fsai. The Appendix A "Do not port" list is final.
- Never mark a milestone complete with failing or skipped tests. If blocked (e.g., missing credential), stub behind an interface, log it in `DECISIONS.md`, and continue.
- Missing credentials expected at this stage: Hostinger SSH, Render, Backblaze, Tripo, Stripe. Everything through M3 must run with local substitutes (local MySQL, local file storage adapter behind the storage interface).

Begin with M0 now.
