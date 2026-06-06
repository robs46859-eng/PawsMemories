# PawsMemories — Fix Specification

**Created:** 2026-06-06  
**Status:** Pending implementation

All fixes are ordered by priority. P0 blocks any real user testing. P1 must ship before public launch. P2 is polish.

---

## P0 — Nothing works without these

---

### FIX-01 · Video bytes extraction is wrong

**File:** `server.ts:1163–1171` and `server.ts:1226–1230`  
**Problem:** Veo returns a GCS URI for the video, not raw `imageBytes`. The code reads `videoData.imageBytes || videoData`, so when `imageBytes` is undefined the fallback is the raw JS object, producing `data:video/mp4;base64,[object Object]` — a corrupt upload every time.

**Fix:** Read the `uri` field from the Veo response, fetch its bytes, then pass to `uploadBase64Image`. Apply to both the on-demand poll route and the background poller.

```ts
// server.ts ~1163 (inside /api/jobs/:id poll route)
const videoData: any = op.response.generatedVideos[0].video;

// BEFORE (broken):
const base64Video = videoData.imageBytes || videoData;
const videoUrl = await uploadBase64Image(`data:video/mp4;base64,${base64Video}`);

// AFTER:
let videoUrl: string;
if (videoData.uri) {
  // Veo returns a signed GCS URI — fetch and re-upload to our bucket
  const gcsRes = await fetch(videoData.uri);
  const buf = Buffer.from(await gcsRes.arrayBuffer());
  const b64 = buf.toString("base64");
  videoUrl = await uploadBase64Image(`data:video/mp4;base64,${b64}`);
} else if (videoData.imageBytes) {
  videoUrl = await uploadBase64Image(`data:video/mp4;base64,${videoData.imageBytes}`);
} else {
  throw new Error("Veo returned no video URI or bytes");
}
```

Apply the same pattern at `server.ts:1226–1229` (background poller block).

---

### FIX-02 · SMS "video ready" notification uses wrong Twilio SID

**File:** `server.ts:1183`, `server.ts:1241`  
**File:** `.env.example`  
**Problem:** `from: process.env.TWILIO_VERIFY_SERVICE_SID` passes a Verify Service SID (`VA…`) as the SMS sender. Twilio Messages requires a phone number (`+1…`) or Messaging Service SID (`MG…`). Every notification throws.

**Fix:** Add a `TWILIO_PHONE_NUMBER` env var and use it as the sender.

`.env.example` — add line:
```
# Twilio phone number used as the SMS sender for notifications (e.g. +15550001234)
TWILIO_PHONE_NUMBER="+1XXXXXXXXXX"
```

`server.ts:1183` and `server.ts:1241`:
```ts
// BEFORE:
from: process.env.TWILIO_VERIFY_SERVICE_SID

// AFTER:
from: process.env.TWILIO_PHONE_NUMBER
```

---

### FIX-03 · Image style-transfer uses a non-existent model name

**File:** `server.ts:676`, `server.ts:795`  
**Problem:** `gemini-2.5-flash-image` is not a valid model. It returns a text response with no `inlineData`, so every photo upload silently falls through to text-only generation — the user's pet photo is never actually used.

**Fix:** Replace with the correct image-generation model.

```ts
// BEFORE:
model: 'gemini-2.5-flash-image',

// AFTER:
model: 'gemini-2.0-flash-exp-image-generation',
```

Apply to both occurrences (style-transfer path ~line 676 and the gemini fallback path ~line 795).

---

### FIX-04 · Admin seed password is hardcoded in source and is not working

**File:** `db.ts:200–233`  
**Problem:** Phone `+13107092939`, email `robs46859@gmail.com`, and password `LoganDen1952` are all committed plaintext. The seed only updates a user that already exists via phone OTP — if the OTP flow hasn't been run first, the admin row doesn't exist and the seed silently skips. This is why the hardcoded login isn't working.

**Fix — two parts:**

**Part A:** Move credentials to env vars. Remove the hardcoded seed block entirely and replace with an env-driven upsert.

`db.ts` — replace the seed block (~lines 199–233) with:
```ts
const adminPhone = process.env.ADMIN_PHONE;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (adminPhone && adminEmail && adminPassword) {
  const { hashPassword } = await import("./auth");
  const passwordHash = hashPassword(adminPassword);
  // INSERT OR UPDATE — works even if the phone OTP row was never created
  await getPool().query(
    `INSERT INTO users (phone, email, password_hash, is_admin, profile_complete, credits, full_name)
     VALUES (?, ?, ?, 1, 1, 9999, 'Admin')
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       password_hash = VALUES(password_hash),
       is_admin = 1,
       profile_complete = 1`,
    [adminPhone, adminEmail, passwordHash]
  );
  console.log("✅ Admin account upserted from env vars.");
}
```

**Part B:** Add the three vars to `.env.example`:
```
ADMIN_PHONE="+1XXXXXXXXXX"
ADMIN_EMAIL="your@email.com"
ADMIN_PASSWORD="choose-a-strong-password"
```

**Part C:** Remove the hardcoded phone string from all three places it appears:

`db.ts:77` — change:
```ts
// BEFORE:
isAdmin: !!userRow.is_admin || userRow.phone === "+13107092939" || userRow.phone === process.env.ADMIN_PHONE,

// AFTER:
isAdmin: !!userRow.is_admin || userRow.phone === process.env.ADMIN_PHONE,
```

`db.ts:561` — change:
```ts
// BEFORE:
if (phone === "+13107092939" || phone === process.env.ADMIN_PHONE) return true;

// AFTER:
if (process.env.ADMIN_PHONE && phone === process.env.ADMIN_PHONE) return true;
```

`server.ts:589` — the `isUserAdmin` call already handles this once `db.ts` is fixed.

---

## P1 — Fix before public launch

---

### FIX-05 · Credits deducted before Veo job starts — no refund on submission failure

**File:** `server.ts:1104–1107`  
**Problem:** 250 credits are deducted before calling `ai.models.generateVideos`. If that call throws (quota, auth, bad image format), the credits are gone with no refund path.

**Fix:** Move deduction to after the Veo call succeeds.

```ts
// Move the deduction block AFTER the op call succeeds:
const op = await ai.models.generateVideos({ ... }); // line ~1126

const operationName = (op as any).name || (op as any).operation?.name;
if (!operationName) throw new Error("Failed to get operation name from Veo");

// Deduct only now that the job is confirmed queued
if (!isAdmin) {
  await deductCredits(userPhone, VIDEO_COST);
}

const jobId = await createJob({ ... });
```

---

### FIX-06 · Admin users receive +250 free credits on failed video jobs

**File:** `server.ts:1194`, `server.ts:1251`  
**Problem:** The background poller and on-demand poll both call `refundCredits` unconditionally on failure. Admin users never had credits deducted, so they gain credits from every failed job.

**Fix:** Gate refund on whether credits were actually reserved.

On-demand poll route (~line 1194):
```ts
// BEFORE:
await refundCredits(req.user!.phone, job.credits_reserved);

// AFTER:
const isAdmin = await isUserAdmin(req.user!.phone);
if (!isAdmin && job.credits_reserved > 0) {
  await refundCredits(req.user!.phone, job.credits_reserved);
}
```

Apply the same guard at the background poller (~line 1251), using `job.user_phone`:
```ts
const jobIsAdmin = await isUserAdmin(job.user_phone);
if (!jobIsAdmin && job.credits_reserved > 0) {
  await refundCredits(job.user_phone, job.credits_reserved);
}
```

---

### FIX-07 · Video polling interval never cleaned up in EditMemory

**File:** `src/components/EditMemory.tsx:331`  
**Problem:** `setInterval` is created inline inside a click handler with no reference stored. If the user navigates away during polling, the interval fires forever.

**Fix:** Store the interval in a ref and clear it on component unmount.

```tsx
// Add at the top of the component:
const videoPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

useEffect(() => {
  return () => {
    if (videoPollingRef.current) clearInterval(videoPollingRef.current);
  };
}, []);

// In the Animate button onClick, replace setInterval with:
videoPollingRef.current = setInterval(async () => {
  try {
    const jobRes = await pollJob(jobId);
    if (jobRes.status === "done") {
      clearInterval(videoPollingRef.current!);
      videoPollingRef.current = null;
      setGeneratedResult({ ...generatedResult, video_url: jobRes.video_url || null, media_type: 'video' });
      onDeductCredits(250);
      setAnimatingVideo(false);
    } else if (jobRes.status === "failed") {
      clearInterval(videoPollingRef.current!);
      videoPollingRef.current = null;
      setErrorMessage(jobRes.error || "Failed to animate video.");
      setAnimatingVideo(false);
    }
  } catch {
    // ignore transient poll errors
  }
}, 3000);
```

---

### FIX-08 · SSRF in `/api/download` proxy

**File:** `server.ts:1050–1069`  
**Problem:** Any authenticated user can pass any URL to `?url=`, causing the server to fetch internal network resources (cloud metadata endpoints, localhost ports, etc.).

**Fix:** Whitelist to the media bucket hostname only.

```ts
app.get("/api/download", requireAuth, async (req: AuthedRequest, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).send("Missing url parameter");

  // Whitelist to our media bucket domain
  const allowed = process.env.MEDIA_BUCKET_URL;
  if (!allowed || !url.startsWith(allowed)) {
    return res.status(403).send("URL not allowed");
  }

  // ... rest of handler unchanged
});
```

---

### FIX-09 · Album ownership not verified when reassigning creation

**File:** `server.ts:1020–1046`  
**Problem:** `PUT /api/creations/:id` accepts `album_id` from the request body without checking that the album belongs to the requesting user. User A can set `album_id` to an album owned by User B.

**Fix:** Add an ownership check before allowing `album_id` updates.

```ts
if (album_id !== undefined && album_id !== null) {
  const [albumRows] = await getPool().query(
    "SELECT id FROM albums WHERE id = ? AND user_phone = ? LIMIT 1",
    [album_id, req.user!.phone]
  ) as any;
  if (!albumRows.length) {
    return res.status(403).json({ success: false, error: "Album not found or not yours." });
  }
  updates.album_id = album_id;
}
```

---

### FIX-10 · Failed video jobs count against daily quota

**File:** `db.ts:550–557`  
**Problem:** `getDailyVideoCount` counts all video jobs including failed ones. A user who hits a Veo error loses one of their 5 daily attempts even though they got their credits back.

**Fix:** Count only non-failed jobs.

```ts
// BEFORE:
`SELECT COUNT(*) as count FROM generation_jobs 
 WHERE user_phone = ? AND kind = 'video' AND DATE(created_at) = CURDATE()`

// AFTER:
`SELECT COUNT(*) as count FROM generation_jobs 
 WHERE user_phone = ? AND kind = 'video' 
 AND status NOT IN ('failed') 
 AND DATE(created_at) = CURDATE()`
```

---

## P2 — Polish

---

### FIX-11 · Brightness/contrast sliders do nothing to generated image

**File:** `server.ts:600`, `src/components/EditMemory.tsx:241`  
**Problem:** Values are sent to the server but never read or included in the AI prompt.

**Fix option A (simple):** Remove the slider values from the POST payload so users aren't misled.  
**Fix option B (better):** Inject them into the prompt:

```ts
// server.ts ~line 641, append to promptText:
if (brightness > 70) {
  promptText += ` Use very bright, high-key lighting.`;
} else if (brightness < 30) {
  promptText += ` Use moody, low-key dramatic lighting.`;
}
if (contrast > 70) {
  promptText += ` High contrast, punchy colors.`;
} else if (contrast < 30) {
  promptText += ` Soft, low-contrast, pastel tones.`;
}
```

---

### FIX-12 · Album covers always show a placeholder

**File:** `server.ts:965`, `server.ts:985`  
**Problem:** All albums show the same hardcoded Unsplash dog photo. The cover should use the first creation in the album.

**Fix:** Update `getAlbums` query to join on the first creation's `image_url`, then return it.

```sql
SELECT a.*, COUNT(c.id) as itemCount,
  (SELECT image_url FROM creations 
   WHERE album_id = a.id 
   ORDER BY sort_order ASC, created_at ASC LIMIT 1) as cover_url
FROM albums a
LEFT JOIN creations c ON a.id = c.album_id
WHERE a.user_phone = ?
GROUP BY a.id
ORDER BY a.created_at DESC
```

Then in `server.ts` route:
```ts
imageUrl: a.cover_url || "https://images.unsplash.com/photo-1548199973-03cce0bbc87b..."
```

---

### FIX-13 · `require('./db')` inside async route handler

**File:** `server.ts:277`  
**Problem:** Dynamic `require` inside the `/api/auth/login` handler. Works in dev but fragile in production bundles.

**Fix:** `getPool` is already imported at the top of the file. Use it directly:

```ts
// BEFORE:
const { getPool } = require("./db");

// AFTER (getPool is already imported at line 9):
// just use getPool() directly — no require needed
```

---

## Environment Variables Checklist

After applying fixes, your `.env.local` / Hostinger env panel needs:

```
# Core (already defined)
GEMINI_API_KEY=
JWT_SECRET=
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=
DB_USER=
DB_PASSWORD=

# Auth
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
TWILIO_PHONE_NUMBER=        ← NEW (FIX-02)

# Admin (replaces hardcoded values)
ADMIN_PHONE=               ← NEW (FIX-04)
ADMIN_EMAIL=               ← NEW (FIX-04)
ADMIN_PASSWORD=            ← NEW (FIX-04)

# Storage
MEDIA_BUCKET_NAME=
MEDIA_BUCKET_URL=
MEDIA_BUCKET_KEY=
MEDIA_BUCKET_SECRET=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Maps (optional)
GOOGLE_MAPS_API_KEY_SERVER=
VITE_GOOGLE_MAPS_API_KEY_BROWSER=

# App
APP_URL=
```
