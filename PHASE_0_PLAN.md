# Phase 0: Planning & Secret Management

**Project:** Paws & Memories (`robs46859-eng/pawsmemories`)  
**Date:** June 5, 2026  
**Objective:** Establish strict secret management, finalize phased rollout plan, and prepare the codebase for Phase 1 execution.

---

## 1. Secret Management Plan

To prevent credential leakage and abuse (especially with new Google Maps and Object Storage integrations), the following strict rules apply:

### 1.1 Key Segregation (Google Maps)
You MUST create **two separate API keys** in the Google Cloud Console:
1. **`GOOGLE_MAPS_API_KEY_SERVER`**  
   - **Usage:** Backend only (`server.ts` Street View Static API calls).  
   - **Restrictions:**  
     - Application restrictions: **IP addresses** (your Hostinger production server IP).  
     - API restrictions: **Street View Static API**, **Street View Image Metadata**.  
   - **Rule:** NEVER commit this to the repo. NEVER expose it to the frontend.

2. **`GOOGLE_MAPS_API_KEY_BROWSER`**  
   - **Usage:** Frontend only (`LocationPicker.tsx` Places Autocomplete + Maps JS API).  
   - **Restrictions:**  
     - Application restrictions: **HTTP referrers** (e.g., `https://mypets.cc/*`, `http://localhost:3000/*`).  
     - API restrictions: **Maps JavaScript API**, **Places API**.  

### 1.2 Environment File Hygiene
- `.env` and `.env.local` are strictly ignored via `.gitignore` (verified: `!.env.example` is the only allowed env file).
- Production secrets are injected via Hostinger's environment variable manager, not committed files.
- Before any commit, run: `git diff --cached` to ensure no `.env` files are staged.

### 1.3 Object Storage Credentials
- `MEDIA_BUCKET_KEY` and `MEDIA_BUCKET_SECRET` must have **least-privilege IAM policies** (e.g., `s3:PutObject` and `s3:GetObject` only on the specific bucket, no `s3:DeleteBucket` or `s3:*`).
- CORS must be configured on the bucket to allow GET requests from `https://mypets.cc`.

### 1.4 Existing Secrets Audit
- `GEMINI_API_KEY`: Already protected. Ensure it has spend caps enabled in Google Cloud Console to prevent runaway Veo billing.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`: Already protected. Ensure webhook endpoints are restricted to Stripe's IP ranges if possible, or rely on signature verification (already implemented in `server.ts`).
- `JWT_SECRET`: Enforced at startup (`server.ts` lines 26-29) to reject lengths < 16 or default values.

---

## 2. Phased Rollout Plan

Execution will proceed in strict phases. Each phase must be tested and merged before the next begins.

### Phase 1: Custom Backdrops + Persistent Album (Current Focus)
**Goal:** Deliver the highest user value with minimal new infrastructure. No video yet.
- [x] **0.1** Update `.env.example` with new required variables (Maps, Object Storage).
- [ ] **1.1** Extend `db.ts`: Add `creations` table to `initDb()`, plus `saveCreation`, `getCreations`, `updateCreation` helpers.
- [ ] **1.2** Backend: Add `/api/streetview/coverage` endpoint (metadata check, free).
- [ ] **1.3** Backend: Extend `/api/create-creation` to accept `location` payload, fetch Street View Static image, and pass both pet photo + backdrop to `gemini-2.5-flash-image`. Save result to DB.
- [ ] **1.4** Frontend: Add `LocationParams` to `src/types.ts`.
- [ ] **1.5** Frontend: Create `src/components/LocationPicker.tsx` (Google Maps JS SDK + Places Autocomplete).
- [ ] **1.6** Frontend: Update `src/components/EditMemory.tsx` to use `LocationPicker` instead of fixed backdrop dropdown.
- [ ] **1.7** Frontend: Update `Dashboard.tsx` to fetch from `/api/creations` instead of local state.

### Phase 2: Object Storage Migration
**Goal:** Prepare for video by moving large media out of the DB/JSON.
- [ ] **2.1** Install object storage SDK (e.g., `@aws-sdk/client-s3`).
- [ ] **2.2** Backend: Create `/api/upload-media` helper or internal function to upload base64 to `MEDIA_BUCKET_URL`.
- [ ] **2.3** Backend: Update `/api/create-creation` to upload the generated image and save `image_url` (not base64) to the `creations` table.
- [ ] **2.4** Frontend: Update `Dashboard.tsx` and `ShareMemory.tsx` to handle URL-based images instead of base64.

### Phase 3: Async Video Generation (Veo)
**Goal:** Bring portraits to life with asynchronous video rendering.
- [ ] **3.1** Extend `db.ts`: Add `generation_jobs` table and `createJob`, `updateJobStatus`, `refundCredits` helpers.
- [ ] **3.2** Backend: Add `/api/create-video` (reserves credits, starts Veo op, returns `jobId`).
- [ ] **3.3** Backend: Add `/api/jobs/:id` (polls job status).
- [ ] **3.4** Backend: Implement in-process background poller (`setInterval`) to check `generation_jobs` and update status/download video.
- [ ] **3.5** Frontend: Add `GenerationJob` to `src/types.ts` and `pollJob` to `src/api.ts`.
- [ ] **3.6** Frontend: Update `Dashboard.tsx` to render `<video>` tags and show "Rendering..." skeleton while polling.

### Phase 4: Polish, Compliance & Safety
**Goal:** Production readiness.
- [ ] **4.1** Add motion presets and audio toggle UI for Veo generation.
- [ ] **4.2** Implement per-user daily rate limits on `/api/create-video`.
- [ ] **4.3** Verify Google Maps ToS compliant attribution in the frontend (`LocationPicker` and rendered albums).
- [ ] **4.4** Add Twilio SMS notification on video completion (leverage existing Twilio setup).

---

## 3. Immediate Next Action

Phase 0.1 is complete (`.env.example` updated).  
Proceeding immediately to **Phase 1.1**: Extending `db.ts` with the `creations` table schema and helper functions.
