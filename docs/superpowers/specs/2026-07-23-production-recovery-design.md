# Pawsome3D Production Recovery Design

**Status:** Proposed for owner approval  
**Date:** 2026-07-23  
**Baseline:** `main` at `3c29854328e4b539796b42cca9d1de458706e5c0`, schema 30  
**Target:** One healthier release with independently verified subsystem gates

## Objective

Correct the current production failures without reverting the global shell,
authentication, PupCoins, FurBin aggregation, physical-fulfillment work, or the
schema-30 durability fixes. The release must make failures visible and
recoverable, prevent cross-account state leakage, and expose only commerce
features that are actually configured.

## Release strategy

The work will be developed as one release branch but divided into isolated
acceptance gates:

1. Animator audio and Randy voice.
2. Create-to-model session lifecycle.
3. Model orientation and motion.
4. FurBin lifecycle and storage.
5. Pawprints and Printful setup.
6. Wardrobe Wags subscription lifecycle.
7. Full build, package, deployment, and live verification.

A subsystem cannot be declared fixed because another subsystem passes. Every
gate requires its own regression tests and user-visible failure state. Render is
deployed before Hostinger whenever a worker change is included.

## Global constraints

- Keep the existing visual language and global shell intact.
- Keep Node `>=24.15 <25` for the main build.
- Keep the Hostinger ZIP prebuilt and started through root `server.cjs`.
- Do not place credentials in Git, browser bundles, API responses, or logs.
- Do not charge PupCoins until the authoritative server operation is accepted.
- Refund reserved PupCoins exactly once on eligible failures.
- Preserve provider handles and durable model URLs.
- Keep Tripo for organic pet/human reconstruction.
- Keep Slant 3D as the only physical 3D-print provider.
- Keep Printful as the Pawprints stationery provider.
- Do not enable Animation Studio or AR navigation as part of this recovery.
- Existing models must remain accessible after the release.

---

## 1. Animator speech preview

### Root cause

`createSpeechPreview()` resolves a file inside `ANIMATOR_DATA_DIR/tmp` and calls
`fs.writeFileSync()` without ensuring that the workspace or `tmp` directory
exists. A clean Hostinger process therefore fails with `ENOENT` before Rhubarb
starts and returns HTTP 502.

### Design

- Initialize the animator workspace at server startup.
- Defensively create the speech-preview temporary directory immediately before
  writing, because runtime cleanup or release replacement can remove it.
- Use asynchronous file operations and a unique per-request filename.
- Keep the `finally` cleanup, but do not allow cleanup errors to replace a
  successful response.
- Validate that `ANIMATOR_DATA_DIR` is writable during `/readyz`; report speech
  as degraded rather than marking the entire website unavailable.
- If ElevenLabs succeeds but Rhubarb is unavailable, return Tier A audio with
  `track: null` as the code already intends.
- If server TTS is unavailable in an interactive preview, expose a clearly
  labeled browser-voice fallback. A browser fallback does not spend PupCoins.

### Acceptance

- A clean data directory can serve the first speech preview.
- Twenty concurrent previews use distinct files and leave no temporary WAVs.
- A missing Rhubarb executable returns playable audio with a degraded tier.
- An ElevenLabs failure refunds the speech charge exactly once.
- No filesystem path is returned to the browser.

---

## 2. Randy voice selection

### Design

Randy’s conversational voice uses the browser Speech Synthesis API. Add a
settings panel that:

- waits for both the immediate `speechSynthesis.getVoices()` result and the
  asynchronous `voiceschanged` event;
- lists the voices actually installed in the current browser;
- groups them by language and identifies local versus remote voices when the
  browser exposes that metadata;
- provides voice, speaking-rate, and pitch preview controls;
- saves the selected voice name, language, rate, and pitch in local storage;
- falls back in order to the saved voice, a matching English voice, and the
  browser default;
- clears a saved selection when that voice no longer exists on the device.

Browser voice names are not portable provider IDs. They must not be stored as a
server-owned global voice or promised across devices. ElevenLabs remains the
server-rendered voice used for durable animator audio.

An open-source hosted TTS model is outside this recovery release. Adding one
requires a separate service, license review, model storage, latency tests, and
abuse controls.

### Acceptance

- The selector populates in Chrome, Safari, and Edge without requiring a reload.
- The selected voice survives a refresh on the same browser.
- An unavailable saved voice falls back without throwing.
- Mute and cancel stop the current utterance.

---

## 3. Create-to-model session lifecycle

### Root causes

- `CreateFlowProvider` is global and is not keyed to the authenticated owner.
  Logging out and signing into another account can leave `sessionId`,
  `candidateImageUrl`, input data, and build state in memory.
- The candidate image can therefore be displayed under a different account.
- The legacy reference screen starts generation from a one-time effect with an
  empty dependency array. If its input is not ready at mount, it never starts.
- A stale or foreign `sessionId` can be posted with a new request. The server
  treats it as the requested primary key even though it does not belong to the
  current owner, leading to session errors or a primary-key collision.
- Retry works because it explicitly calls the generation function rather than
  depending on the mount effect.

### Design

- Associate client create-flow state with an opaque owner fingerprint derived
  from the current authenticated user ID. Do not use email or phone in storage.
- Reset the complete create-flow state on login, logout, owner change, and
  “Start another model.”
- Store only resumable job UUIDs in `sessionStorage`, namespaced by the owner
  fingerprint. Do not persist photos, prompts, signed URLs, candidate images, or
  raw session IDs across owners.
- Replace the mount-only generator with an explicit state machine:
  `input_ready → submitting → reference_ready | failed_retryable`.
- The Generate button creates a fresh client request UUID and disables itself
  while that request is active.
- The server generates the session UUID. A client may update/remake a session
  only after an ownership lookup succeeds.
- If a client submits a missing, expired, or foreign session during a new
  generation, the server creates a new session rather than reusing that ID.
  Update, approval, and build endpoints continue to fail closed on foreign IDs.
- Remake creates a new immutable reference attempt under the same owned session;
  it never overwrites the approved candidate.
- Return stable error codes such as `SESSION_EXPIRED`,
  `SESSION_OWNER_MISMATCH`, `REFERENCE_PROVIDER_UNAVAILABLE`, and
  `REFERENCE_RETRYABLE`. The browser maps these to useful actions.
- Ensure the first provider call begins from the Generate action. Retry must use
  the same orchestration path, not a separate implementation.

### Acceptance

- Account A’s candidate never appears after signing into account B in the same
  tab.
- Two tabs and two accounts cannot read or mutate one another’s sessions.
- The first Generate click starts one provider request.
- Double-clicking Generate starts one request.
- A transient provider failure exposes Retry and does not charge twice.
- A stale session offers “Start a fresh model” rather than a red dead-end.

---

## 4. Model orientation and motion

### Root causes

- `PetModelViewer` pins the camera orbit but does not normalize the asset’s
  forward axis.
- Generated and legacy assets do not all share one recorded forward convention.
- The living-avatar runtime automatically resolves and loops embedded clips
  containing `idle`, `breath`, or `stand`. Those clips can sway even though the
  procedural idle fallback is stationary.

### Canonical convention

- Pawsome3D canonical model space is Y-up.
- A front-facing asset looks toward the camera in the standard preview.
- New worker exports must store or apply the canonical forward transform before
  upload.
- Each model-library record may carry a bounded yaw correction for legacy
  assets. The client never guesses a new correction on every render.

### Design

- Add a deterministic orientation fixture for a known asymmetric dog model.
- Verify the Tripo source orientation, worker output orientation, and browser
  viewer orientation with front/left/rear screenshots.
- Correct new models at the worker/export boundary and record the transform in
  model metadata.
- Apply a one-time legacy yaw correction in the viewer for existing models that
  predate canonical metadata.
- Add an owner control in the model detail view: Front, Left, Right, Rear, and
  “Save this as front.” Saving writes the correction to the owned model record.
- Never autoplay an animation in FurBin or the default model detail view.
- In living-avatar surfaces, suppress `idle`, `breath`, and `stand` clips.
  Stationary idle means no translation, bounce, roll, procedural breathing, or
  animation-mixer contribution.
- Play motion only after an explicit action button, animation script, or movement
  target. When the action ends, return to a frozen neutral pose.
- Camera-facing means body yaw is initialized to the saved canonical front, not
  continuously head-tracked.

### Acceptance

- The known dog fixture faces the camera on first render.
- Existing models can save a corrected front without modifying the GLB.
- A 30-second idle capture has no changing root transform or mixer time.
- Walk/run/action clips still play when explicitly selected.

---

## 5. FurBin lifecycle, organization, and storage

### Current limitation

Production uses the legacy FurBin because `FUR_BIN_V5_ENABLED=false`. That view
aggregates models and creations but provides mostly viewing/downloading. Existing
retry and avatar hide APIs are not mapped into source-aware FurBin actions.

### Design

Build recovery controls into the production FurBin without enabling unfinished
V5 globally.

Each item exposes only actions valid for its source and state:

- **View** and **Download** for completed owned files.
- **Retry build** for retryable failed jobs.
- **Remake** for completed models, with a price confirmation and a new attempt;
  the old model remains available.
- **Rename**, **tag**, and **add to collection** for organization.
- **Move to Trash** for models, images, videos, Pawprints, and voice files.
- **Restore** from Trash.
- **Delete forever** only from Trash, with typed confirmation.

Add additive schema-31 records for owner-scoped collections, tags, trash state,
and source identity. Do not expose database IDs or object-storage keys.

Permanent deletion:

- is blocked while an asset backs an active print order, marketplace listing, or
  paid entitlement;
- deletes only objects owned exclusively by that asset;
- updates storage accounting transactionally;
- records a non-secret audit event;
- never deletes a shared source used by a derivative.

### Storage purchase

The current “Add more” button immediately attempts a four-PupCoin purchase and
does not show a durable success/error state.

Replace it with:

1. A confirmation sheet stating `1 GB`, the exact PupCoin cost, current balance,
   and whether storage is hot or cold.
2. A stable idempotency key created when the sheet opens.
3. Server-authoritative balance validation and one ledger entry.
4. A success state showing the new allowance.
5. An actionable error state for balance, configuration, or network failure.

“Add more” remains disabled if cold-storage delivery is not configured. It must
say why rather than doing nothing.

### Acceptance

- A failed model can be retried from FurBin.
- A completed model can be remade without replacing its prior version.
- Items can be renamed, collected, tagged, trashed, restored, and permanently
  deleted when unreferenced.
- Cross-owner item IDs return 404.
- Storage purchases are idempotent and visibly refresh the meter.
- Permanent deletion releases the correct owned bytes.

---

## 6. Pawprints and Printful product-sync setup

### Provider facts

Printful’s current API uses:

- a private token for authentication;
- `X-PF-Store-Id` when an account-level token needs explicit store context;
- catalog `variant_id` for a physical size/product variation;
- optional `product_template_id` for an existing Printful product template;
- one or more final print-file URLs on an order item.

Pawsome3D’s finished 300-DPI Pawprint remains the order artwork. A Printful
template is a product/placement configuration, not a replacement for the
customer’s final image.

Official reference: <https://developers.printful.com/docs/>

### Admin screen

Add **Admin → Pawprints Fulfillment → Printful Setup** with a guided progression:

#### Step 1: Connection

- Explain how to create a Printful Manual Orders/API store.
- Explain how to create a private token.
- Never accept or display the token in the browser.
- Show whether `PRINTFUL_API_KEY` and `PRINTFUL_STORE_ID` are configured.
- Call a read-only server verification endpoint and display the authenticated
  store name/ID, token scope type, and token-expiry warning when available.

#### Step 2: Sync catalog

- Search real Printful catalog products through the existing server adapter.
- Filter to supported stationery/wall-art categories.
- Refresh the bounded six-hour catalog cache.
- Select a product and load real catalog variants.

#### Step 3: Select variant and placement

- Display size, color, base price, availability, and catalog variant ID.
- Fetch authoritative placement geometry from
  `/mockup-generator/printfiles/{productId}`.
- Require one supported placement with positive width, height, and DPI.
- Show the required pixel aspect ratio and target output dimensions.

#### Step 4: Optional product template

- List the account’s real Printful product templates.
- Allow selecting a compatible template whose
  `available_variant_ids` contains the chosen variant.
- Permit “No product template” and construct orders on the fly with the catalog
  variant plus the Pawsome3D print file.

#### Step 5: Pawsome3D offering

- Enter an internal code, customer label, description, width, height, retail
  price, and display order.
- Calculate minimum retail price from Printful base cost plus the configured
  margin floor.
- Persist the product, variant, placement, dimensions, price, optional template,
  verification timestamp, and status in schema 31.
- Statuses are `draft`, `verified`, `published`, `unavailable`, and `archived`.

#### Step 6: Verify and publish

- Re-fetch the variant, placement, and optional template.
- Render a bounded sample Pawprint at the exact placement ratio.
- Create a provider draft estimate/order only when an explicit admin test action
  is confirmed; never submit it to fulfillment.
- Publish only after authentication, compatibility, dimensions, price, and
  sample-file checks pass.

### Customer Pawprints

- `/api/pawprints/print-products` reads published database offerings, not raw
  environment JSON.
- If there are no verified offerings, the physical-print section says
  “Print products are not configured” and digital Pawprints continue to work.
- The browser receives public codes and labels, never Printful IDs.
- Checkout resolves the public code server-side to the verified configuration.
- Stripe payment still occurs before a Printful draft is confirmed.
- Printful tracking remains visible in FurBin.

### Setup instructions delivered with the release

Create `PRINTFUL_SETUP.md` covering:

1. Create a Printful account.
2. Create a Manual Orders/API store.
3. Create a private token with store and order permissions.
4. Put `PRINTFUL_API_KEY` and, when required, `PRINTFUL_STORE_ID` in Hostinger.
5. Restart the Node application.
6. Open the admin Printful Setup screen.
7. Verify the connection.
8. Sync the catalog.
9. Select products, variants, placements, and optional templates.
10. Set pricing and publish.
11. Run one Stripe test checkout and keep the Printful order as a draft.
12. Switch to live Stripe only after a physical sample is approved.

### Acceptance

- Invalid or expired tokens produce a useful admin error and no customer product.
- Account-level tokens require the correct store ID.
- Incompatible template/variant pairs cannot publish.
- A customer cannot substitute a variant, template, price, or print-file URL.
- A paid webhook confirms one Printful order exactly once.
- A failed provider order preserves the Pawprint and exposes retry to admin.

---

## 7. Wardrobe Wags

### Root cause

The repository contains a legacy `/api/wags/*` subscription implementation and a
separate gated `/api/wags-v2/*` implementation. The customer-facing experience
does not provide one complete subscription lifecycle, while admin and
cancellation paths can receive an ID from the other system. The result is a
legitimate “Subscription not found” response with no recovery path.

### Design

- Choose Wags V2 as the canonical durable implementation.
- Do not enable it until four Stripe price IDs and the separate Wags webhook
  secret are configured.
- Add an owner-scoped subscription read endpoint that returns `none`, `pending`,
  `active`, `past_due`, `cancel_at_period_end`, or `canceled`; absence is a valid
  state, not an error.
- Add a Stripe Checkout subscription flow. Do not collect raw payment-method IDs
  in the Pawsome3D browser.
- Include the durable Wags subscription UUID in Checkout and subscription
  metadata.
- Reconcile Checkout completion and subscription events idempotently.
- The customer sees Subscribe when no subscription exists, Manage when active,
  Resume when Checkout is pending, and Contact Support when reconciliation
  requires intervention.
- Legacy subscriptions are read and migrated by an idempotent schema-31 job.
- Legacy endpoints remain read-only compatibility shims for one release and
  cannot create a second subscription.

### Acceptance

- A user with no subscription sees a purchase option, not an error.
- A completed Stripe Checkout produces one owned subscription.
- Refreshing the success page does not duplicate it.
- Cancel, renewal, failed payment, and resume states reconcile correctly.
- An ID owned by another user returns 404.

---

## 8. Testing and deployment gate

### Focused tests

- Animator temp-directory, concurrency, degradation, and refund tests.
- Browser voice selection and missing-voice fallback tests.
- Create-flow owner-switch, stale-session, first-submit, retry, and double-click
  tests.
- Orientation fixture and frozen-idle tests.
- FurBin source-action, ownership, trash, restore, purge, storage-accounting, and
  purchase-idempotency tests.
- Printful token/store, catalog, template compatibility, publication, price, and
  webhook-idempotency tests using provider fakes.
- Wags no-subscription, Checkout, reconciliation, migration, renewal, and cancel
  tests.

### Full local gate

- `npm run lint`
- focused Node tests
- `npm run test`
- `npm run test:ar`
- `npm run test:contracts`
- `npm run test:security`
- `npm run animator:doctor`
- `npm run build`
- browser smoke test at desktop and mobile widths
- verify the global shell and home page have not regressed
- build a clean ZIP from committed HEAD
- verify release manifest, schema, Node engine, file count, and SHA-256

### Live deployment

1. Deploy Render Docker first if orientation/export code changed.
2. Verify `/health`, bridge connection, Blender version, and authenticated worker
   rejection.
3. Add schema-31 variables and provider secrets in Hostinger.
4. Upload the verified ZIP and restart the Node application.
5. Verify `/readyz` and `/version`.
6. Smoke-test two separate user accounts for session isolation.
7. Generate a reference on the first click, retry one controlled failure, and
   verify the model reaches FurBin.
8. Confirm front orientation and frozen idle.
9. Test FurBin organization, trash, and storage purchase.
10. Verify Printful setup with a provider read and one draft-only test.
11. Verify Wags test-mode Checkout and reconciliation.
12. Verify Randy browser voice and ElevenLabs animator preview.

## Out of scope

- New AR work.
- Rebuilding Animation Studio.
- Hosting an open-source TTS model.
- Replacing Tripo, Slant 3D, Printful, Stripe, Backblaze, or ElevenLabs.
- Enabling the in-house spatial generator.
- Automatically submitting a live Printful order before sample approval.

