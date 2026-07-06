# X_DM_REFINEMENT_SPEC.md
# Pawsome3D — LLM-Driven Conversational 3D Refinement over X (formerly Twitter) DMs
# + X-Derived Dynamic Style & Prompt-Engineering Library

**Version:** 1.0 · **Date:** 2026-07-06 · **Status:** Ready for implementation
**Verified against:** docs.x.com (X API v2), July 2026

---

## 0. Executive Summary

Two new backend capabilities, both built on the **X API v2**:

1. **Conversational 3D Refinement via X DMs.** A user DMs the `@Pawsome3D` account a prompt (optionally with a pet photo). The backend generates a preliminary draft render, sends it back as a DM image, and the user iterates in natural language ("make the textures more metallic, add rust to the edges"). A multimodal LLM interprets each reply against the current render and drives the existing Tripo + blender-worker pipeline. DM conversation IDs give us free, persistent per-user session state.

2. **Trending Aesthetic Library (prompt preset harvesting).** A scheduled harvester searches X design communities for high-engagement posts, and a multimodal LLM extracts trending aesthetic vocabulary (`low-poly`, `photorealistic studio lighting`, `voxel art`, …) into a scored keyword dictionary. The web app's prompt box (and the DM bot) silently injects top-scoring modifier tokens into casual users' prompts.

Both features live in one new service: **`x-dm-service`** (Node/Express, deployable next to the existing blender-worker on Render).

---

## 1. Critical X API Access Reality Check (read before building)

| Fact | Implication |
|---|---|
| New developers get **pay-per-use credits** (post read ≈ $0.005, post create $0.015, DM reads ≈ $0.01; 2M reads/mo cap). Legacy Basic ($200/mo) / Pro ($5,000/mo) are closed to new signups; Enterprise ≈ $42k/mo. | Budget per-message costs. Cache aggressively. The harvester (Feature B) is the main read-cost driver — cap it (see §7.6). |
| Platform-wide DM send limit: **~500 DMs/day per account** (X anti-spam rule, applies to the bot account). | Hard-cap daily sessions; queue and prioritize paying users. |
| DM endpoints require **user-context auth** (OAuth 2.0 PKCE). App-only bearer tokens are rejected on all `/2/dm_*` routes. | The **bot account itself** must complete the OAuth flow once against our own app; store + refresh its token (§4.1). |
| Webhook DM delivery has had reliability incidents (devcommunity reports of dropped `dm` events in 2025–2026). | Ship **webhook-first with polling fallback** (§5.4). Never rely on webhooks alone. |
| DM lookup retention: **30 days**. | Persist every event in our own DB immediately (§6). |
| Full-archive search is Pro/Enterprise-only. | Feature B uses **recent search (last 7 days)** only — which is actually what we want for "trending". |

**Endpoint availability by tier changes; the implementing agent must re-verify at https://docs.x.com/x-api/overview before wiring each endpoint.**

---

## 2. Architecture

```
                         ┌────────────────────────────┐
   X Platform            │  x-dm-service (Render)      │
┌───────────────┐  POST  │  ├ /webhooks/x   (CRC+events)│
│ Webhooks/     ├───────►│  ├ dmRouter      (state)     │
│ X Activity API│        │  ├ refinementEngine (LLM)    │
└──────┬────────┘        │  ├ trendHarvester (cron)     │
       ▲                 │  └ xClient       (API calls) │
       │ REST            └──────┬──────────┬────────────┘
       │                        │          │
┌──────┴────────┐        ┌──────▼───┐ ┌────▼─────────────┐
│ X API v2      │        │ MySQL    │ │ blender-worker   │
│ api.x.com/2/* │        │ (existing│ │ (Render, existing│
└───────────────┘        │ mypets.cc│ │ WORKER_SHARED_   │
                         │ DB)      │ │ SECRET auth)     │
                         └──────────┘ └────┬─────────────┘
                                           │
                              ┌────────────▼───────────┐
                              │ Tripo multiview API +   │
                              │ Backblaze B2 (renders)  │
                              └────────────────────────┘
```

- **x-dm-service** is new. Node 20 + Express. Deploy on Render (same account as blender-worker) because Hostinger shared hosting can't reliably host a public HTTPS webhook without port restrictions.
- Reuses: existing MySQL DB, Backblaze bucket, Tripo pipeline, blender-worker (auth via `WORKER_SHARED_SECRET`), credits ledger.
- LLM: any multimodal chat-completions API (Claude claude-sonnet-* recommended; interface abstracted in `llm.ts` so a cheap agent can swap providers).

---

## 3. X Developer App Setup (one-time, manual)

1. Create/verify a developer account at developer.x.com, create a **Project + App**.
2. App settings → User authentication: enable **OAuth 2.0**, type **Web App**, callback `https://<x-dm-service>/oauth/callback`, website `https://pawsome3d.com`.
3. Record: **Client ID**, **Client Secret**, **API Key (consumer key)**, **API Key Secret (consumer secret)** — the consumer secret is required for webhook CRC (§5.2), separate from OAuth 2.0 credentials.
4. Scopes needed: `dm.read dm.write tweet.read users.read media.write offline.access`
   (`offline.access` → refresh tokens; `tweet.read users.read` are mandatory companions to dm scopes).
5. Log in **as the @Pawsome3D bot account** and complete the app's OAuth consent once (§4.1 flow) to mint the bot's user token.

### Environment variables (x-dm-service)

```
X_CLIENT_ID=
X_CLIENT_SECRET=
X_CONSUMER_SECRET=            # CRC + webhook signature verification
X_BOT_USER_ID=                # numeric id of @Pawsome3D account
X_BOT_ACCESS_TOKEN=           # seeded by one-time OAuth; auto-refreshed
X_BOT_REFRESH_TOKEN=
X_WEBHOOK_URL=https://<service>/webhooks/x
LLM_API_KEY=                  # OpenRouter key
LLM_MODEL=nvidia/nemotron-nano-12b-v2-vl:free   # any OpenAI-compatible vision model id
LLM_BASE_URL=https://openrouter.ai/api/v1
DM_DAILY_SEND_CAP=400         # keep headroom under X's ~500/day
HARVEST_MAX_POSTS_PER_RUN=300 # read-cost cap

# --- Shared with the existing main app (.env.example) — REUSE THESE EXACT NAMES
# so one .env works for both services. Do NOT invent DATABASE_URL / WORKER_URL /
# B2_* names; the config loader must read the names below:
DB_HOST= DB_PORT= DB_NAME= DB_USER= DB_PASSWORD=   # MySQL (compose pool config from parts;
                                                   # on Render use the remote host, not 127.0.0.1)
BLENDER_WORKER_URL=           # existing; may include a path like /render — strip to origin
WORKER_SHARED_SECRET=         # must match blender-worker (existing constraint)
MEDIA_BUCKET_NAME= MEDIA_BUCKET_URL= MEDIA_BUCKET_KEY= MEDIA_BUCKET_SECRET=   # Backblaze B2
```

---

## 4. Authentication

### 4.1 OAuth 2.0 Authorization Code + PKCE (bot account, one-time + refresh)

**Step 1 — authorize URL** (open in browser, logged in as bot):

```
GET https://x.com/i/oauth2/authorize
  ?response_type=code
  &client_id={X_CLIENT_ID}
  &redirect_uri=https://<service>/oauth/callback
  &scope=dm.read%20dm.write%20tweet.read%20users.read%20media.write%20offline.access
  &state={random}
  &code_challenge={S256(code_verifier)}
  &code_challenge_method=S256
```

**Step 2 — exchange code:**

```
POST https://api.x.com/2/oauth2/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=authorization_code&code={code}
&redirect_uri=https://<service>/oauth/callback
&code_verifier={code_verifier}
```

Response: `{ "access_token": "...", "refresh_token": "...", "expires_in": 7200 }`

**Step 3 — refresh (cron, every ~90 min or on 401):**

```
POST https://api.x.com/2/oauth2/token
Authorization: Basic base64(client_id:client_secret)

grant_type=refresh_token&refresh_token={X_BOT_REFRESH_TOKEN}
```

Persist rotated tokens in DB table `x_oauth_tokens` (never only in env).

### 4.2 App-only bearer token

Used ONLY for: webhook management (§5.1), X Activity subscriptions (§5.3), recent search + trends (Feature B).

```
POST https://api.x.com/2/oauth2/token
Authorization: Basic base64(api_key:api_key_secret)
grant_type=client_credentials
```

---

## 5. Feature A — Conversational DM Refinement

### 5.1 Webhook registration (app-only bearer)

| # | Call | Purpose |
|---|---|---|
| A1 | `POST /2/webhooks` body `{"url": "{X_WEBHOOK_URL}"}` | Register; X fires CRC immediately. Returns `data.id` (webhook_id) — persist it. |
| A2 | `GET /2/webhooks` | List/verify (`valid: true`). |
| A3 | `PUT /2/webhooks/:webhook_id` | Re-trigger CRC to re-enable an invalidated webhook. |
| A4 | `DELETE /2/webhooks/:webhook_id` | Teardown. |
| A5 | `POST /2/webhooks/:webhook_id/replay` (replay job) | Recover missed events after outage. |

Failure codes to handle on A1: `CrcValidationFailed`, `UrlValidationFailed` (no port in URL, must be plain https), `DuplicateUrlFailed`, `WebhookLimitExceeded`.

### 5.2 CRC + signature verification (must-have, exact algorithm)

X validates the endpoint on registration and **hourly**; failing CRC silently stops event delivery.

```js
// GET /webhooks/x?crc_token=...   → respond within 3s
import crypto from "crypto";
app.get("/webhooks/x", (req, res) => {
  const hmac = crypto.createHmac("sha256", process.env.X_CONSUMER_SECRET)
    .update(req.query.crc_token).digest("base64");
  res.json({ response_token: `sha256=${hmac}` });
});

// POST /webhooks/x → verify x-twitter-webhooks-signature over RAW body
function verifySig(rawBody, header) {
  const expected = "sha256=" + crypto.createHmac("sha256", process.env.X_CONSUMER_SECRET)
    .update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}
```

Notes from docs: use the **consumer secret** (not bearer/access token); events may arrive **duplicated → dedupe by event id**; our own outbound DMs are also delivered back to the webhook (filter `sender_id === X_BOT_USER_ID`).

### 5.3 Event subscription — X Activity API (app-only bearer)

Subscribe the bot account's DM traffic to our webhook:

| # | Call | Body / notes |
|---|---|---|
| A6 | `POST /2/activity/subscriptions` | `{"event_type":"dm.received","filter":{"user_id":"{X_BOT_USER_ID}"},"tag":"pawsome3d-dm-in","webhook_id":"{webhook_id}"}` |
| A7 | `POST /2/activity/subscriptions` | same with `"event_type":"dm.sent"` (lets us confirm deliveries) |
| A8 | `GET /2/activity/subscriptions` | audit on boot |
| A9 | `PUT /2/activity/subscriptions/:id` | move to new webhook_id |
| A10 | `DELETE /2/activity/subscriptions/:id` | teardown |
| A11 | `GET /2/activity/stream` | optional persistent HTTP stream — use in dev instead of ngrok |

Self-serve tier allows 1,000 subscriptions — we need 2. Legacy DM event types: `dm.received`, `dm.sent`, `dm.read`, `dm.indicate_typing`. (XChat/encrypted events `chat.*` are NOT accessible to bots — encrypted DMs from users who force XChat can't be read; reply capability degrades gracefully, see §5.8.)

### 5.4 Polling fallback — DM Lookup (bot user token)

Cron every 60s when webhook `valid=false` OR no event received in 15 min while sessions are active:

| # | Call | Purpose |
|---|---|---|
| A12 | `GET /2/dm_events?dm_event.fields=id,text,event_type,dm_conversation_id,sender_id,created_at,attachments&expansions=attachments.media_keys,sender_id&media.fields=url,type,width,height&max_results=100&pagination_token=...` | All DM events for bot user (30-day retention). Walk pages until we hit last-seen event id. |
| A13 | `GET /2/dm_conversations/:dm_conversation_id/dm_events` (same params) | Catch-up for one conversation. |
| A14 | `GET /2/dm_conversations/with/:participant_id/dm_events` | 1:1 catch-up by user id. |
| A15 | `GET /2/dm_events/:event_id` | Single-event fetch (webhook gave us only an id). |

Event types returned: `MessageCreate`, `ParticipantsJoin`, `ParticipantsLeave`.

### 5.5 Sending DMs (bot user token)

| # | Call | Purpose |
|---|---|---|
| A16 | `POST /2/dm_conversations/with/:participant_id/messages` body `{"text":"..."}` or `{"text":"...","attachments":[{"media_id":"..."}]}` | Reply in 1:1 conversation (creates it if absent). **Primary send call.** |
| A17 | `POST /2/dm_conversations/:dm_conversation_id/messages` | Reply by conversation id (use when we have the id from an event — cheaper/safer). |
| A18 | `POST /2/dm_conversations` body `{"conversation_type":"Group","participant_ids":[...],"message":{"text":"..."}}` | Group sessions (v2 feature; optional "design with a friend" mode). |
| A19 | `DELETE /2/dm_events/:event_id` | Delete a bot message (moderation/rollback). |

Constraints: at least one of `text`/`attachments`; **max ONE media attachment per DM**; media must be uploaded by the same authenticated user (the bot) and is valid 24h after upload; 403 if recipient's DM settings block unknown senders → reply path is only guaranteed after the user DMs first.

### 5.6 Media upload (send draft renders) — chunked upload (bot user token)

All renders go out as PNG/JPEG (≤5 MB → single chunk) or short MP4 turntables:

| # | Call | Body |
|---|---|---|
| A20 | `POST /2/media/upload` multipart `command=INIT, media_type=image/png, total_bytes=<n>, media_category=dm_image` | → `data.id` (media_id) |
| A21 | `POST /2/media/upload` multipart `command=APPEND, media_id, segment_index=0.., media=@chunk` | 1 MB chunks |
| A22 | `POST /2/media/upload` multipart `command=FINALIZE, media_id` | may return `processing_info` |
| A23 | `GET /2/media/upload?command=STATUS&media_id=...` | poll `pending→in_progress→succeeded/failed` honoring `check_after_secs` |

Categories: use `dm_image` / `dm_video` / `dm_gif` for DM attachments (`tweet_*` categories are for Posts — the implementing agent must confirm the `dm_*` category strings on docs.x.com media reference; if unsupported on the current tier, fall back to hosting the render on B2 and sending the URL as text — X auto-previews image links in DMs).

**Downloading user-sent photos:** DM events with attachments expose `media_keys` → expansion `attachments.media_keys` with `media.fields=url` gives a CDN URL on `ton.x.com`/`pbs.twimg.com`; fetch it with the bot's **OAuth user token in the Authorization header** (DM media is private).

### 5.7 Conversation state machine

```
IDLE ──prompt DM──► DRAFTING ──render sent──► REFINING ◄──feedback loop──┐
                                              │  │ "done"/"export"       │
                                              │  └──────────► FINALIZING ┘
   any state: "restart" → IDLE, "help" → help text  FINALIZING → deliver GLB link → IDLE
```

DB (MySQL, existing instance — new tables):

```sql
CREATE TABLE dm_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  dm_conversation_id VARCHAR(64) UNIQUE NOT NULL,   -- X conversation id = session key
  x_user_id VARCHAR(32) NOT NULL,
  x_username VARCHAR(64),
  app_user_id BIGINT NULL,             -- linked pawsome3d account (optional, §5.9)
  state ENUM('IDLE','DRAFTING','REFINING','FINALIZING') DEFAULT 'IDLE',
  base_prompt TEXT,                    -- original user prompt
  effective_prompt TEXT,               -- prompt + injected style tokens (Feature B)
  tripo_task_id VARCHAR(128),
  current_render_url TEXT,             -- B2 url of latest render
  current_model_url TEXT,              -- B2 url of latest GLB
  revision INT DEFAULT 0,
  credits_charged INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE dm_events_log (
  event_id VARCHAR(64) PRIMARY KEY,    -- dedupe key (webhooks may duplicate)
  dm_conversation_id VARCHAR(64),
  sender_id VARCHAR(32),
  event_type VARCHAR(32),
  text TEXT, media_keys JSON,
  raw JSON, received_via ENUM('webhook','poll'),
  created_at DATETIME
);

CREATE TABLE dm_turns (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT REFERENCES dm_sessions(id),
  role ENUM('user','assistant','system'),
  content TEXT,                        -- user text or LLM edit-plan JSON
  render_url TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.8 Refinement engine (LLM loop) — the core

On each inbound `MessageCreate` from a session in REFINING:

1. Load last N=10 `dm_turns` + `current_render_url` (fetch image bytes from B2).
2. Call multimodal LLM with system prompt (below), the current render **as an image**, conversation history, and the new user message.
3. LLM returns strict JSON **edit plan**:

```json
{
  "intent": "refine | new_object | finalize | restart | help | smalltalk",
  "operations": [
    {"op": "texture",  "target": "body",  "params": {"material": "metal", "roughness": 0.35, "detail": "rust on edges"}},
    {"op": "geometry", "target": "ears",  "params": {"scale": 1.2}},
    {"op": "style",    "params": {"preset": "voxel_art"}},
    {"op": "lighting", "params": {"preset": "studio_3pt"}},
    {"op": "palette",  "params": {"lock": true, "colors": ["#8a5a2b", "#f2e9dc"]}}
  ],
  "regenerate_strategy": "texture_only | tripo_full | blender_postprocess",
  "revised_prompt": "full regenerated text prompt incl. accumulated edits",
  "user_reply": "Working on it! Adding metallic sheen + rusty edges 🔧"
}
```

4. Dispatch by `regenerate_strategy`:
   - `texture_only` → blender-worker `/jobs` (existing secret auth) with material/shader ops on current GLB; re-render thumbnail.
   - `tripo_full` → existing multiview Tripo pipeline with `revised_prompt` (+ palette-lock params already in the repo).
   - `blender_postprocess` → geometry tweaks (scale/mirror/decimate) via blender-worker on current GLB.
5. Upload render PNG to B2 → chunked-upload to X (A20–A23) → send DM (A17) with `user_reply` + attachment. Increment `revision`, persist turn.
6. `intent=finalize` → send GLB/USDZ download link (B2 signed URL) + deep link `https://pawsome3d.com/avatar?import=<session>`; deduct credits from existing ledger.

**LLM system prompt (store as `prompts/refine_system.txt`):**

```
You are the refinement brain of Pawsome3D, operating inside X Direct Messages.
You see the CURRENT RENDER as an image plus the conversation so far.
Interpret the user's latest message as 3D editing instructions.
Rules:
- Output ONLY the JSON edit-plan schema, no prose outside "user_reply".
- Accumulate edits: revised_prompt must contain ALL prior accepted changes.
- Choose texture_only or blender_postprocess whenever possible (cheap, <60s);
  choose tripo_full only when topology/shape must change.
- If the message is ambiguous, pick the most likely interpretation and note it
  in user_reply ("I made X — say 'undo' if you meant Y").
- Keep user_reply under 200 chars, friendly, no hashtags.
- intent=smalltalk for non-editing chatter; answer briefly, don't render.
```

**Latency handling:** Tripo full regen takes minutes. Immediately send a text-only ack DM ("On it — ~2 min ⏳"), then send the render when ready. Never leave a DM unanswered >10s.

**Undo:** keep last 3 render/model URLs per session; "undo" → pointer rollback, no recompute.

### 5.9 Account linking & credits (optional Phase 2)

DM "link my account" → bot replies with `https://pawsome3d.com/link-x?code=<one-time>`; user logs into the web app, code binds `x_user_id`→`app_user_id`. Until linked: 3 free DM generations per X user (tracked on `dm_sessions.credits_charged`), then prompt to link/buy credits (existing Stripe packs).

### 5.10 Guardrails

- Ignore events where `sender_id == X_BOT_USER_ID` (own echoes).
- Dedupe on `dm_events_log.event_id` before processing.
- Rate limits: on any 429 read `x-rate-limit-reset` header and back off; global daily send counter enforced at `DM_DAILY_SEND_CAP`.
- Content: run existing pet-image moderation on user-supplied photos before sending to Tripo; refuse non-pet/NSFW with a canned DM.
- Never render text from users into shell commands / file paths (prompt-injection hygiene: the LLM output is data, validate JSON against schema with zod, whitelist `op` values).

---

## 6. Feature B — Trending Aesthetic Library

### 6.1 Data collection (app-only bearer; all read-metered — respect HARVEST_MAX_POSTS_PER_RUN)

| # | Call | Purpose |
|---|---|---|
| B1 | `GET /2/tweets/search/recent?query=...&max_results=100&sort_order=relevancy&tweet.fields=public_metrics,created_at,entities,lang&expansions=attachments.media_keys,author_id&media.fields=url,preview_image_url,type&user.fields=public_metrics` | Core harvest. Last 7 days = "trending" window. |
| B2 | `GET /2/tweets/counts/recent?query=...&granularity=day` | Cheap volume trend per candidate keyword (counts are cheaper than reads) — compute rising/falling slope. |
| B3 | `GET /2/trends/by/woeid/1` (1 = worldwide; 23424977 = US) | Platform trends; filter for design/3D-adjacent entries. |
| B4 | `GET /2/users/:id/liked_tweets` / `GET /2/lists/:id/tweets` | Optional: curated seed lists of 3D artists ("public collections") — maintain `seed_accounts` table. |
| B5 | `POST /2/tweets/search/stream/rules` + `GET /2/tweets/search/stream` | Optional Phase 2: filtered stream with rules like `(#b3d OR #blender3d OR #lowpoly) has:images -is:retweet` for real-time capture (also deliverable to webhook per current docs). |

**Harvest queries (rotate, one per cron tick to control cost):**

```
q1: (#3dart OR #blender3d OR #b3d OR #3dmodeling) has:images -is:retweet lang:en
q2: ("low poly" OR lowpoly OR voxel OR isometric) (art OR render OR model) has:images -is:retweet
q3: (#gameart OR #stylized3d OR #pbr OR "hand painted") has:images -is:retweet
q4: (render OR sculpt) ("studio lighting" OR photorealistic OR claymation OR "toon shader") has:images
q5: (#pixelart3d OR #voxelart OR #3dcharacter) (cute OR pet OR animal) has:images -is:retweet
```

### 6.2 Extraction pipeline (cron: every 6h)

1. Pull ≤100 posts per query (B1). Skip already-seen tweet ids.
2. **Engagement score** per post: `(likes + 2*retweets + 3*bookmarks + replies) / max(author_followers, 1000)^0.5` — normalizes mega-accounts.
3. Feed top-quartile posts (text + image URLs) to multimodal LLM in batches of 20:

```
System: You are an art-direction analyst. From these X posts about 3D art
(text + attached image), extract aesthetic descriptors that materially change
how a 3D render looks. Return JSON:
[{"keyword":"brushed bronze patina","category":"material|style|lighting|palette|mood|technique",
  "confidence":0-1,"prompt_fragment":"brushed bronze with subtle patina, PBR metallic-roughness"}]
Ignore hashtags-as-spam, tool names, and non-visual terms.
```

4. Upsert into dictionary with decayed scoring:

```sql
CREATE TABLE aesthetic_keywords (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  keyword VARCHAR(120) UNIQUE,
  category ENUM('material','style','lighting','palette','mood','technique'),
  prompt_fragment TEXT,              -- injection-ready token string
  score DOUBLE DEFAULT 0,            -- engagement-weighted, decayed
  velocity DOUBLE DEFAULT 0,         -- slope from B2 counts
  sample_tweet_ids JSON,
  first_seen DATE, last_seen DATE,
  status ENUM('active','curated','banned') DEFAULT 'active'
);
-- nightly decay: UPDATE aesthetic_keywords SET score = score * 0.93;
-- on hit:        score = score + post_engagement_score; last_seen = today
```

5. Weekly: LLM pass over top-50 keywords → merge near-duplicates ("lowpoly"≈"low-poly"), flag `banned` (trademarks, artist names — never inject living artists' names/styles).

### 6.3 Injection at generation time (web app + DM bot)

New module `promptEnhancer.ts`, called by BOTH the existing website generator and §5.8's `revised_prompt` builder:

```
input : userPrompt, petSpecies, userSkillLevel (casual|pro)
logic : if pro → return userPrompt unchanged (respect power users)
        else:
          cats = LLM-classify or keyword-match which categories userPrompt already covers
          pick top-scored ACTIVE keyword from ≤3 uncovered categories
          (1 material + 1 lighting + 1 style; require score > threshold)
output: `${userPrompt}, ${fragments.join(", ")}`  + metadata of injected tokens
```

- Surface injected tokens in the UI as removable chips ("✨ studio lighting × voxel style") — transparency + one-tap removal.
- Log `injected_tokens` per generation; join against user keep/regenerate actions → weekly report ranks which X-derived tokens actually improve keep-rate (closes the loop; auto-demote losers).
- Expose as internal endpoint: `GET /api/style-presets` → top 12 active keywords grouped by category (web app renders as preset buttons).

---

## 7. Cross-cutting

### 7.1 Rate-limit & error policy
- Every xClient call: honor `x-rate-limit-remaining` / `x-rate-limit-reset`; on 429 sleep until reset + jitter.
- 401 on user-token calls → run refresh (§4.1 step 3) once, retry, else alert.
- 403 on DM send → mark session `blocked`, don't retry (user closed DMs).
- Webhook down (CRC fail alert from `GET /2/webhooks` hourly self-check) → enable polling (A12), call A3 to revalidate, and A5 replay job to backfill.

### 7.2 Cost model (order-of-magnitude, verify current pricing)
- One refinement turn ≈ 1 DM read ($0.01) + 1 media upload + 1 DM send + LLM (~$0.01–0.05) + Tripo/GPU. Charge ≥1 credit per full regen; texture-only tweaks can be free.
- Harvest tick ≈ ≤300 post reads ($1.50) + counts + LLM extraction (~$0.30). At 4 ticks/day ≈ ~$220/mo ceiling — tune `HARVEST_MAX_POSTS_PER_RUN` down if keep-rate uplift doesn't justify it.

### 7.3 Security
- CRC secret = consumer secret only; never log tokens; verify `x-twitter-webhooks-signature` on every POST (timing-safe compare on raw body — register Express `raw` body parser for the webhook route BEFORE json parser).
- blender-worker calls keep existing `WORKER_SHARED_SECRET` header.
- Treat all DM text as untrusted (zod-validate LLM JSON, whitelist ops).

### 7.4 Testing
- `xurl webhook start` (github.com/xdevplatform/xurl) for local CRC/webhook testing via ngrok.
- Dev mode: consume `GET /2/activity/stream` instead of a public webhook.
- Fixtures: record real webhook payloads into `test/fixtures/` on first run; unit-test dedupe, CRC, signature, state machine, edit-plan schema.

### 7.5 Implementation milestones (hand to coding agent in this order)
1. **M1** x-dm-service skeleton: Express, env, MySQL migrations, xClient with auth (§4), CRC endpoint passing `xurl` test.
2. **M2** Webhook + subscriptions (A1–A11), event logging + dedupe, polling fallback (A12–A15).
3. **M3** Echo bot: reply "got it" to any DM (A16/A17). Verify 500/day counter.
4. **M4** Media path: upload render (A20–A23), send image DM, download inbound photo.
5. **M5** State machine + refinement engine (§5.7–5.8) wired to existing Tripo + blender-worker.
6. **M6** Trend harvester (B1–B3) + `aesthetic_keywords` + cron.
7. **M7** `promptEnhancer` in web app + preset chips UI + keep-rate logging.
8. **M8** Account linking + credits (§5.9), undo, group sessions (A18).

### 7.6 Open items for the implementing agent to verify against docs.x.com
- Exact `media_category` strings accepted for DM attachments on the current tier.
- Whether webhook DM events arrive as X Activity `dm.received` envelopes or legacy Account Activity `direct_message_events` shape — log first real payload and adapt the parser (both shapes documented; keep parser tolerant).
- Current pay-per-use prices & whether `/2/trends/by/woeid` is available on the account's tier.

---

## 8. Sources
- DM manage integration guide: https://docs.x.com/x-api/direct-messages/manage/integrate
- DM lookup: https://docs.x.com/x-api/direct-messages/lookup/introduction
- Chunked media upload: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- Webhooks quickstart (CRC, signatures, replay): https://docs.x.com/x-api/webhooks/quickstart
- X Activity API (dm.received etc.): https://docs.x.com/x-api/activity/introduction / quickstart
- Rate limits: https://docs.x.com/x-api/fundamentals/rate-limits
- Pricing context (2026 pay-per-use): https://postproxy.dev/blog/x-api-pricing-2026/ , https://www.blotato.com/blog/twitter-api-pricing
