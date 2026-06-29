# Build Spec: Paws & Memories (Video & Location Backdrops)

**Based on:** `buildout-video-and-location-backdrops.md`  
**Target Repo:** `robs46859-eng/pawsmemories`  
**Stack:** Express, React + Vite, MySQL (`mysql2`), `@google/genai`, Stripe.

---

## 1. Codebase Gap Analysis

| Feature Area | Current State | Required State |
|---|---|---|
| **Data Persistence** | Client-side memory only (no DB table for creations) | New `creations` and `generation_jobs` MySQL tables in `db.ts`. |
| **Image Generation** | Synchronous, returns base64 directly. | Extended to accept `location` object, fetches Street View, passes 2 images to `gemini-2.5-flash-image`. |
| **Video Generation** | Non-existent. | New async `/api/create-video` and `/api/jobs/:id` endpoints. Veo long-running operation polling. |
| **Credit Flow** | Immediate `deductCredits` on success. | New `reserveCredits`, `settleCredits`, `refundCredits` for async video jobs. |
| **Frontend UI** | Fixed 4 backdrops, `<img>` only. | `LocationPicker` component, media-type toggle, `<video>` rendering, job status polling UI. |

---

## 2. Database Schema (Add to `db.ts` `initDb`)

```sql
CREATE TABLE IF NOT EXISTS creations (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_phone    VARCHAR(32) NOT NULL,
  album_id      INT NULL,
  media_type    ENUM('still','video') NOT NULL DEFAULT 'still',
  style         VARCHAR(32) NOT NULL,
  backdrop_kind ENUM('preset','streetview') NOT NULL DEFAULT 'preset',
  preset_name   VARCHAR(32) NULL,
  sv_lat        DECIMAL(10,7) NULL,
  sv_lng        DECIMAL(10,7) NULL,
  sv_heading    SMALLINT NULL,
  sv_pitch      SMALLINT NULL,
  sv_fov        SMALLINT NULL,
  place_label   VARCHAR(190) NULL,
  image_url     VARCHAR(512) NULL,
  video_url     VARCHAR(512) NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_phone), INDEX (album_id),
  FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS generation_jobs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_phone      VARCHAR(32) NOT NULL,
  creation_id     INT NULL,
  kind            ENUM('still','video') NOT NULL,
  status          ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  operation_name  VARCHAR(255) NULL,
  credits_reserved INT NOT NULL DEFAULT 0,
  error           VARCHAR(512) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (user_phone), INDEX (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 3. Backend Implementation (`db.ts` & `server.ts`)

### 3.1 Database Helpers (`db.ts`)
Add the following functions to support the new tables:
- `saveCreation(data)`: Inserts/updates a creation record.
- `getCreations(phone)`: Returns user's album items ordered by `sort_order`.
- `createJob(phone, creationId, kind, creditsReserved, operationName)`: Enqueues a job.
- `updateJobStatus(jobId, status, error?, operationName?)`: Transitions job state.
- `reserveCredits(phone, amount)`: Atomically checks balance and reserves (new `reserved_credits` column needed on `users` table, or track solely in `generation_jobs`). *Simpler approach: just validate balance, deduct on success, refund on failure.*
- `refundCredits(phone, amount)`: Adds credits back on job failure.

### 3.2 Street View Endpoints (`server.ts`)
```typescript
// Check coverage (free, prevents paid Static API calls on gray boxes)
app.get("/api/streetview/coverage", requireAuth, async (req, res) => {
  const { lat, lng } = req.query;
  // fetch https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY_SERVER}
});
```

### 3.3 Extended Image Creation (`server.ts`)
Modify `/api/create-creation`:
1. Accept optional `location: { lat, lng, heading, pitch, fov, placeLabel }` in `req.body`.
2. If present, call `/api/streetview/coverage`. If OK, fetch Static API image.
3. Pass `inlineData` of both pet photo and Street View backdrop to `gemini-2.5-flash-image`.
4. Update prompt: `Composite the pet naturally into this real location backdrop (${placeLabel}), matching its lighting and perspective, rendered in the ${style} style.`
5. Save to `creations` table, deduct 40 credits.

### 3.4 Async Video Endpoints (`server.ts`)
```typescript
// Enqueue Veo job
app.post("/api/create-video", requireAuth, async (req, res) => {
  // 1. Validate balance (e.g., 250 credits)
  // 2. INSERT INTO generation_jobs (status='queued', credits_reserved=250)
  // 3. Call ai.models.generateVideos({ model: "veo-3.1-fast-generate-preview", image: ..., prompt: ... })
  // 4. UPDATE generation_jobs SET operation_name=..., status='running'
  // 5. Return { jobId, status: 'queued' } (HTTP 202)
});

// Poll job status
app.get("/api/jobs/:id", requireAuth, async (req, res) => {
  // SELECT status, error, video_url FROM generation_jobs WHERE id=? AND user_phone=?
  // If status === 'running', optionally poll Google API here (or rely on background worker)
});
```

### 3.5 Background Worker (`server.ts` or separate `worker.ts`)
```typescript
// Simple in-process poller for Phase 3
setInterval(async () => {
  const jobs = await getRunningJobs();
  for (const job of jobs) {
    const op = await ai.operations.getVideosOperation({ operation: { name: job.operation_name } });
    if (op.done) {
      if (op.response?.generatedVideos?.[0]?.video) {
        // TODO: Upload to object storage, get URL
        await updateJobStatus(job.id, 'done', undefined, videoUrl);
        await settleCredits(job.user_phone, job.credits_reserved); // or just leave deducted
      } else {
        await updateJobStatus(job.id, 'failed', 'Generation returned no video');
        await refundCredits(job.user_phone, job.credits_reserved);
      }
    }
  }
}, 15000);
```

---

## 4. Frontend Implementation (`src/`)

### 4.1 Type Updates (`src/types.ts`)
```typescript
export interface LocationParams {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  fov: number;
  placeLabel: string;
}

export interface Creation {
  id: number;
  mediaType: 'still' | 'video';
  style: StyleType;
  backdropKind: 'preset' | 'streetview';
  presetName?: string;
  location?: LocationParams;
  imageUrl?: string;
  videoUrl?: string;
  sortOrder: number;
}

export interface GenerationJob {
  id: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  videoUrl?: string;
  error?: string;
}
```

### 4.2 API Client Updates (`src/api.ts`)
Add `createVideo(creationId, motionPrompt)`, `pollJob(jobId)`, `fetchCreations()`, `updateCreation(id, data)`.

### 4.3 New Component: `LocationPicker.tsx`
- Uses Google Maps JavaScript API (`StreetViewPanorama`, `PlacesAutocomplete`).
- Allows user to search a place, drop a pin, and rotate/tilt the view.
- On confirm, returns `LocationParams` to parent.

### 4.4 Update `EditMemory.tsx`
- Add toggle: `Still` vs `Video`.
- Replace/augment backdrop selector with `LocationPicker`.
- If `Video`, show motion preset dropdown ("gentle breeze", "slow push-in") + audio toggle.
- On submit, call `/api/create-creation` (still) or `/api/create-video` (video).

### 4.5 Update `Dashboard.tsx`
- Fetch creations via `/api/creations` instead of local state.
- Render `<img>` for `mediaType === 'still'`, `<video autoPlay loop muted playsInline>` for `mediaType === 'video'`.
- Add "Animate" button for stills.
- Add polling logic: if a creation has a pending job, show "Rendering..." skeleton, poll `/api/jobs/:id` every 10s until `done`.

---

## 5. Configuration & Environment (`.env`)

Add the following to `.env` and `.env.example`:
```env
# Google Maps Platform (Restrict browser key by HTTP referrer: mypets.cc)
GOOGLE_MAPS_API_KEY_SERVER="..."
GOOGLE_MAPS_API_KEY_BROWSER="..."

# Object Storage (Phase 2/3 prereq for video)
MEDIA_BUCKET_URL="..."
MEDIA_BUCKET_KEY="..."
MEDIA_BUCKET_SECRET="..."
```
*Note: Keep `GEMINI_API_KEY` for Veo and Imagen/Gemini image generation.*

---

## 6. Phased Rollout Plan

**Phase 1: Custom Backdrops + Persistent Album (Highest Value, Lowest Risk)**
- [ ] Add `creations` table to `db.ts`.
- [ ] Add `/api/streetview/coverage` and Static API fetch logic.
- [ ] Extend `/api/create-creation` to accept `location` and pass 2 images to Gemini.
- [ ] Build `LocationPicker.tsx` and wire into `EditMemory.tsx`.
- [ ] Build `/api/creations` GET/PUT endpoints and update `Dashboard.tsx` to persist state.

**Phase 2: Object Storage Migration**
- [ ] Integrate S3/GCS/Hostinger storage SDK.
- [ ] Update `/api/create-creation` to upload generated base64 to object storage and save `image_url` to DB.

**Phase 3: Video MVP**
- [ ] Add `generation_jobs` table and credit reserve/refund helpers.
- [ ] Implement `/api/create-video` and `/api/jobs/:id`.
- [ ] Add in-process background poller for Veo operations.
- [ ] Update `Dashboard.tsx` to render `<video>` and handle polling UI.

**Phase 4: Polish & Compliance**
- [ ] Add motion presets and audio toggle for Veo.
- [ ] Implement per-user daily video caps and rate limiting.
- [ ] Verify Google Maps ToS compliance for transient Street View usage.
- [ ] Add Twilio SMS notification on video completion (leverage existing Twilio setup).

---

## 7. Immediate Next Actions (Phase 1 Kickoff)
1. Run SQL migrations in `db.ts` `initDb()`.
2. Create `src/components/LocationPicker.tsx`.
3. Extend `src/types.ts` and `src/api.ts`.
4. Modify `server.ts` `/api/create-creation` to handle the `location` payload and dual-image Gemini call.
