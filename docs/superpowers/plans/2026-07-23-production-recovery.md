# Pawsome3D Production Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before reporting success.

**Goal:** Restore the production customer journeys that are currently broken or incomplete: speech preview, isolated create sessions, stable model presentation, FurBin lifecycle controls, storage purchases, Printful product setup, and Wags subscriptions.

**Architecture:** Keep the existing Express/Vite/MySQL/Backblaze/Stripe/Printful architecture. Make additive schema changes through the existing migration runner, preserve ownership checks at every media boundary, and prefer the already-built V2 service layers over parallel legacy implementations. All provider secrets stay server-side.

**Tech Stack:** Node 24.18, TypeScript, React, Express, MySQL, Stripe, Backblaze B2/S3, Printful, Three.js/model-viewer, Node test runner.

## Global Constraints

- Work only in `codex/production-recovery-2026-07-23`.
- Do not expose Animation Studio or AR; both remain disabled.
- Do not persist candidate photos or signed URLs in browser storage.
- Never trust a client-supplied user, session owner, price, provider identifier, or media key.
- Do not delete Backblaze objects until database ownership and reference counts are verified.
- Use `PupCoins`, never `credits`, in customer-facing text.
- Run all Node commands with:
  `PATH=/Users/robert/.nvm/versions/node/v24.18.0/bin:$PATH`.
- Baseline recorded on 2026-07-23: 1,064 passed, 0 failed, 3 skipped.

## Task 1: Repair Speech Preview and Add a Reliable Randy Voice Picker

**Files**

- Modify: `server/animator/speechPreview.ts`
- Modify: `server/animator/paths.ts`
- Modify: `src/animator/speech/browserSpeech.ts`
- Modify: `src/components/RandyChat.tsx`
- Test: `tests/animator_speech_preview.test.mjs`
- Test: `tests/randy_browser_voice.test.mjs`

### Checklist

- [x] Add a failing test proving speech preview succeeds when `ANIMATOR_DATA_DIR/tmp` does not exist.
- [x] Add a failing test proving concurrent previews use distinct files and always clean them up.
- [x] Add an `ensureWorkspaceDirectory("tmp")` helper that resolves below the animator root and creates the directory recursively.
- [x] Ensure the directory immediately before writing the WAV; use asynchronous file I/O where practical.
- [x] Keep cleanup in `finally`, treating an already-absent temporary file as success.
- [x] Add a pure browser-voice preference module that loads voices after `voiceschanged`, chooses by stable voice URI/name, and falls back to the first English voice.
- [x] Persist only `voiceURI`, rate, and pitch in local browser storage; never store speech content.
- [x] Add a compact Randy voice selector with Preview and Reset controls.
- [x] Run:
  `npm test -- tests/animator_speech_preview.test.mjs tests/randy_browser_voice.test.mjs`

**Acceptance**

- A fresh Hostinger data directory can generate speech without ENOENT.
- Two concurrent previews cannot overwrite each other.
- Randy speaks with the selected installed browser voice, with a deterministic fallback.

## Task 2: Isolate Create Sessions and Make Generation Deterministic

**Files**

- Modify: `src/components/create-flow/CreateFlowContext.tsx`
- Modify: `src/components/create-flow/CreateReferenceScreen.tsx`
- Modify: `src/components/create-flow/CreateScreen.tsx`
- Modify: `server.ts`
- Modify: `db.ts`
- Test: `tests/create_flow_owner_isolation.test.mjs`
- Test: `tests/create_pipeline_session_routes.test.mjs`

### Checklist

- [ ] Add failing tests for account A signing out and account B seeing no candidate, session ID, or photo from A.
- [ ] Add failing tests proving a stale or foreign session ID cannot be adopted by a new generation request.
- [ ] Key create-flow state by the authenticated server identity and reset all sensitive state when that identity changes.
- [ ] Namespace the resumable job UUID by owner. Do not browser-persist source photos, candidate URLs, or signed media URLs.
- [ ] Replace the one-shot reference-screen effect with an explicit, idempotent generation command that can run once prerequisites are ready.
- [ ] Disable Generate while a request is active and surface a retryable, user-readable provider error.
- [ ] Have the server allocate new pipeline session IDs. A client may resume only a session confirmed to belong to that user.
- [ ] Make update and approve routes fail closed on stale or foreign sessions.
- [ ] Preserve exact-retry idempotency for approval and generation.
- [ ] Run:
  `npm test -- tests/create_flow_owner_isolation.test.mjs tests/create_pipeline_session_routes.test.mjs tests/create_flow_corrections.test.mjs`

**Acceptance**

- No candidate crosses accounts in a same-browser sign-out/sign-in sequence.
- First Generate starts processing without requiring Retry.
- A stale session produces a fresh safe generation session or a clear recoverable message, never a foreign-session collision.

## Task 3: Normalize Model Facing and Eliminate Idle Sway

**Files**

- Modify: `src/components/PetModelViewer.tsx`
- Modify: `src/three/AvatarModel.tsx`
- Modify: `src/three/clipMap.ts`
- Add: `src/three/modelPresentation.ts`
- Test: `tests/model_presentation.test.mjs`
- Test: `tests/avatar_static_idle.test.mjs`

### Checklist

- [ ] Add a failing pure-function test for canonical front orientation and legacy 90-degree correction.
- [ ] Add a failing test proving `idle`, `breath`, and `stand` embedded clips are not auto-played in static FurBin/model views.
- [ ] Introduce explicit presentation metadata: `forwardAxis`, `yawCorrectionDegrees`, and `motionPolicy`.
- [ ] Default new models to camera-facing canonical orientation.
- [ ] Apply the legacy correction only through the presentation layer; do not destructively rewrite GLBs.
- [ ] Keep all mixers stopped in static views. Animation may run only after an explicit action in an enabled animation-capable surface.
- [ ] Verify with a known asymmetric model fixture so front/back mistakes are visible.
- [ ] Run:
  `npm test -- tests/model_presentation.test.mjs tests/avatar_static_idle.test.mjs`

**Acceptance**

- Models face the camera on initial load.
- Static models do not breathe, sway, or inherit provider animation.
- Existing GLB downloads remain byte-for-byte untouched.

## Task 4: Make FurBin the Durable Creation Library

**Files**

- Modify: `server/migrations/runner.ts`
- Modify: `db.ts`
- Modify: `server.ts`
- Modify: `src/components/FurBinScreen.tsx`
- Modify: `src/api.ts`
- Add: `src/components/furbin/FurBinItemActions.tsx`
- Add: `src/components/furbin/FurBinCollections.tsx`
- Test: `tests/furbin_lifecycle.test.mjs`
- Test: `tests/furbin_ui_contract.test.mjs`

### Checklist

- [ ] Add migration 31 for user-owned collections, collection membership, tags, trash timestamps, source type, and source ID.
- [ ] Add unique keys that prevent the same creation being imported twice.
- [ ] Build one normalized FurBin item contract for avatars, creations, Pawprints, and videos.
- [ ] Add source-aware actions: View, Download, Retry/Remake, Move, Tag, Trash, Restore, and Delete Permanently.
- [ ] Retry only failed/retryable jobs and preserve idempotency.
- [ ] Use soft delete first. Permanent deletion must verify ownership and block deletion when the asset is referenced by an order, active job, published listing, or shared item.
- [ ] Delete underlying Backblaze media only after reference checks pass.
- [ ] Organize All by output type and creation date using tall opaque glass cards.
- [ ] Make “Your creations” aliases route to and display “Your FurBin.”
- [ ] Run:
  `npm test -- tests/furbin_lifecycle.test.mjs tests/furbin_ui_contract.test.mjs`

**Acceptance**

- Past and new models appear through one owned path.
- Users can retry failures, organize output, trash, restore, and safely delete.
- Ordered or shared assets cannot be accidentally destroyed.

## Task 5: Repair the Storage Purchase Experience

**Files**

- Modify: `src/components/StorageMeter.tsx`
- Modify: `src/api.ts`
- Modify: `server.ts`
- Test: `tests/storage_purchase.test.mjs`
- Test: `tests/storage_meter_ui.test.mjs`

### Checklist

- [ ] Add tests for confirmation, stable request ID across rerenders, success, insufficient PupCoins, and exact retry.
- [ ] Open a confirmation panel showing added capacity, PupCoin price, current balance, and resulting capacity.
- [ ] Generate the idempotency key only when the user begins a purchase attempt; reuse it for retries of that attempt.
- [ ] Disable duplicate submissions and refresh both storage and PupCoin balances after success.
- [ ] Surface server error text in the panel and keep it retryable.
- [ ] Run:
  `npm test -- tests/storage_purchase.test.mjs tests/storage_meter_ui.test.mjs`

**Acceptance**

- “Add more” opens a real purchase flow and communicates its result.
- Retries cannot double-charge.

## Task 6: Build Printful Product Sync and Publish Real Pawprints

**Files**

- Modify: `server/migrations/runner.ts`
- Modify: `server/printfulCatalog.ts`
- Modify: `server/customizerCheckout.ts`
- Modify: `server.ts`
- Add: `src/components/admin/PrintfulSetupScreen.tsx`
- Modify: `src/components/PawprintsStudio.tsx`
- Modify: `src/App.tsx`
- Add: `PRINTFUL_SETUP.md`
- Test: `tests/printful_setup.test.mjs`
- Test: `tests/pawprints_published_products.test.mjs`

### Checklist

- [ ] Extend migration 31 with database-backed Printful product configuration and publish state.
- [ ] Add server-only connection diagnostics that reveal configuration status but never the token.
- [ ] Support both store-scoped tokens and account-level tokens with `PRINTFUL_STORE_ID`.
- [ ] Build Admin → Pawprints Fulfillment with: Check Connection, Sync Catalog, Select Product, Select Variant, Select Placement, Printfile Requirements, Optional Template, Retail Price, Margin, Verify, Publish.
- [ ] Persist variant IDs as physical catalog variants, not template numbers.
- [ ] Validate final customer artwork against Printful placement dimensions and the existing 300-DPI contract before checkout.
- [ ] Load customer Pawprints products only from verified, published database rows; remove fake/static purchasable placeholders.
- [ ] Keep Stripe payment before provider submission and preserve existing idempotent order confirmation.
- [ ] Write `PRINTFUL_SETUP.md` with token type, store creation, store ID, product sync, template compatibility, pricing, publish, webhook, and test-order steps.
- [ ] Run:
  `npm test -- tests/printful_catalog.test.mjs tests/printful_fulfillment.test.mjs tests/printful_setup.test.mjs tests/pawprints_published_products.test.mjs`

**Acceptance**

- An admin can connect a Printful store, sync a product, configure a printable variant, verify it, and publish it without editing environment JSON.
- A customer can personalize a published Pawprint, pay through Stripe, and create one idempotent Printful order.

## Task 7: Consolidate Wags on V2 and Repair Subscription Checkout

**Files**

- Modify: `server/wags-v2/routes.ts`
- Modify: `server/wags-v2/production.ts`
- Modify: `server.ts`
- Modify: `src/components/WagsScreen.tsx`
- Modify: `src/api.ts`
- Test: `tests/wags_subscription_ui.test.mjs`
- Test: `tests/phase7_wags_api_routes.test.mjs`

### Checklist

- [ ] Add tests for no-subscription, checkout creation, success return, cancelled return, stale legacy ID, and webhook-driven activation.
- [ ] Make Wags V2 the single UI/API contract.
- [ ] Use Stripe Checkout in subscription mode; do not accept raw payment method IDs from the browser.
- [ ] Treat no subscription as a valid state with a Subscribe action, not an error.
- [ ] Add a compatibility lookup for owned legacy subscription records without mixing provider IDs and internal UUIDs.
- [ ] Use a dedicated Wags Stripe webhook secret and process events idempotently.
- [ ] Refresh Wags state after Checkout returns and show pending/active/cancelled states.
- [ ] Run:
  `npm test -- tests/wags_subscription_ui.test.mjs tests/phase7_wags_api_routes.test.mjs tests/phase7_wags_production_adapter.test.mjs`

**Acceptance**

- A new user sees subscription options, not “Subscription not found.”
- Checkout and webhook completion produce one active entitlement without duplicate grants.

## Task 8: Full Verification, Package, Deploy, and Smoke Test

**Files**

- Modify: `DEPLOYMENT_VARIABLES.md` only if new required names were introduced
- Modify: `RELEASE_DEPLOYMENT_INSTRUCTIONS.md`
- Generate: `pawsome3d-deploy.zip`

### Checklist

- [ ] Run focused tests from Tasks 1–7.
- [ ] Run full tests:
  `npm test`
- [ ] Run type and lint gates:
  `npx tsc --noEmit`
  `npm run lint`
- [ ] Run the production build:
  `npm run build`
- [ ] Verify `dist/server.cjs` exists and starts under Node 24.18.
- [ ] Inspect the built shell for logo/nav/home regressions.
- [ ] Package only tracked HEAD plus generated production artifacts; exclude `.env`, secrets, local data, logs, tests, worktrees, and prior ZIPs.
- [ ] Record the ZIP SHA-256 and file size.
- [ ] Commit and push the recovery branch.
- [ ] Deploy to Hostinger, explicitly restart the Node application, and confirm the running asset hashes match the ZIP.
- [ ] Run authenticated smoke tests for speech, account switching, create/reference/approve, FurBin retry/trash, storage purchase confirmation, Printful admin sync, Pawprints checkout, and Wags checkout.
- [ ] Inspect Hostinger, Render node worker, and Render Docker worker logs for five minutes after smoke traffic.

**Release gate**

Do not call the recovery production-ready unless every automated gate passes and the live authenticated smoke test confirms the deployed process is running the new bundle. If a provider cannot be exercised safely, mark that provider flow “deployment-configured, live transaction not yet verified” and do not substitute a mocked result.
