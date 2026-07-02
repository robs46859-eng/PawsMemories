# Paws & Memories

Turn your pet photos into magical claymation, sketch, and artistic digital heirlooms — guided by Randy, an AI assistant. Paws & Memories is a full‑stack web app with email + password sign‑in, a credits system, AI image generation, and the option to order a physical printed photo album.

Live site: https://mypets.cc

## Tech stack

- **Frontend:** React 19 + Vite 6, Tailwind CSS 4, Lucide icons, Motion for animation
- **Backend:** Node 22 + Express 4 (single `server.ts`, bundled to `dist/server.cjs` with esbuild)
- **Auth:** Email + password with JWT session tokens (passwords hashed with scrypt)
- **Database:** MySQL (via `mysql2`) for the user store
- **AI / 3D:** Google Gemini for chat, Imagen for stills, Veo for video. **Tripo3D** for Image-to-3D mesh generation (replaced Meshy for higher quality and reliability). Blender 3D via dedicated `bpy` microservice with EEVEE PBR rendering and 24-frame cycles.
- **Payments:** Stripe Checkout (memory requests, physical album orders, credit packs) with webhook verification
- **Notifications:** Twilio SMS for notifying users when their memory requests are fulfilled
- **Hosting:** Hostinger for main app. Render.com for the Blender microservice.

## How it fits together

The Express server does double duty: it serves the built Vite frontend from `dist/` and exposes the JSON API under `/api`. Authentication is email + password: a user signs up, is then required to complete a profile, and receives a 30‑day JWT that gates the rest of the app.

### Auth & gating flow

1. `POST /api/auth/signup` — creates an account from an **email + password**. Email must be unique. Returns a 30‑day JWT. New users start with a **profile‑incomplete** record (and 0 credits).
2. `POST /api/auth/complete-profile` — required for every new user. Saves full name, birthdate, city, and pets to MySQL, and grants **50 free credits** the first time the profile is completed.
3. `POST /api/auth/login` — email + password login for returning users; returns a JWT.
4. `GET /api/me` — restores the current user from a valid `Bearer` token.

Protected routes use the `requireAuth` middleware, which rejects any request without a valid session token. The frontend additionally blocks any user whose profile is incomplete from reaching the app, so the profile step is enforced for every new account.

### Database

Tables are created automatically on boot (`initDb()`). The `users` table:

| column | notes |
| --- | --- |
| `id` | auto‑increment primary key |
| `phone` | **internal opaque user key** (e.g. `u_3f9a…`), unique. Not a phone number — kept because `albums`, `creations`, `generation_jobs`, and `pets` foreign‑key to it. |
| `email` | unique — the login identifier (lower‑cased) |
| `password_hash` | scrypt salt:hash |
| `full_name`, `birthdate`, `city` | filled in at profile completion |
| `credits` | starts at 0, +50 on first profile completion |
| `treats` | daily streak reward count, used to feed pet avatars |
| `profile_complete` | `0` / `1` |
| `is_admin` | `0` / `1` |
| `created_at` | timestamp |

The `avatars` table:

| column | notes |
| --- | --- |
| `id` | auto‑increment primary key |
| `user_phone` | links to the owner's `phone` |
| `name` | custom name of the pet avatar |
| `image_url` | URL of the avatar image (preset or generated) |
| `food_level` | current food percentage (0-100, decays 5%/hr) |
| `water_level` | current water percentage (0-100, decays 5%/hr) |
| `last_fed` | timestamp of the last feeding action |
| `last_watered` | timestamp of the last watering action |
| `created_at` | timestamp |

> The legacy Twilio/phone verification flow has been removed. The `phone` column is now just a stable internal key per user.

### Memory Requests & Admin Fulfillment

Direct AI generation of photos and videos is restricted to **Admins**. Regular users must use the **Request a Memory** flow:
1. User submits a request (specifying photo or video, style tier, and instructions).
2. User pays upfront flat rates via **Stripe Checkout**.
3. Admin receives the pending request in the **Admin Dashboard**, and generates the photo/video using the premium AI tools.
4. Admin clicks "Fulfill", which clones the generated creation to the user's gallery and sends an automated **Twilio SMS** to notify the user.

## AI Pet Avatar & Tamagotchi System

Paws & Memories features an interactive, Tamagotchi-style pet avatar system with the following mechanics:

- **Multi-Agent 3D Avatar Stack**: Pet photos are converted to 3D meshes via **Tripo3D** (Image-to-3D), then processed by an autonomous multi-agent pipeline (built on LangGraph). The pipeline includes:
  - *Perceive*: Analyzes the uploaded photo to determine species, breed, body type, and proportions.
  - *Reason*: Formulates a step-by-step Blender build plan with breed-specific anatomy, facial rigging (jaw, ears, eyes), and 24-frame cycles.
  - *Act & Verify*: Generates and executes Blender Python (`bpy`) scripts iteratively, verifying geometry and bone hierarchies.
  - *Visual-Verify*: Uses Gemini Vision to compare the final 3D viewport render against the original photo, automatically recovering from anatomical anomalies.
- **Microservice Architecture**: Because the main app runs on Hostinger shared hosting, the generated `bpy` scripts are sent securely via HTTP to a dedicated Docker microservice (`blender-worker`) running on Render, which safely executes the render and returns the 3D Avatar.
- **Life-like Biological Economy**: Avatars track their **Food** and **Water** levels. Both levels decay naturally over time (5% per hour). Users must feed and water their pets to keep them healthy.
- **Daily Treats**: Claiming the daily login streak rewards users with virtual **Treats** in addition to credits. Treats can be fed to avatars for bonus food.
- **3D Playpen Yard**: Displays pets in a grassy yard featuring:
  - **3D Parallax Hover**: Moving your cursor tilts the yard dynamically in 3D space.
  - **Idle Roaming**: Pets hop, roam, and flip directions automatically.
  - **Action Drop Animations**: Feeding, watering, or giving a treat drops the item into the yard. The pet runs to it, eats it, displays happy emoji bursts, and then updates the database.
  - **Tired & Trick States**: Low-energy pets move slower and show sleepy `💤` bubbles. Tapping a pet makes it perform a spin or jump trick.

### Blender 5.1 Update & AI Safety Engine
The rendering engine has been upgraded to **Blender 5.1**. Due to significant API deprecations in recent Blender versions, an AI script safety post-processor (`sanitizeBlenderScript()`) acts as a safeguard. This protects the worker from crashing when the LLM hallucinating legacy properties:
- **EEVEE-Next Migrations:** Deprecated `use_contact_shadows` is stripped (EEVEE-Next relies on implicit raytracing).
- **Lighting Deprecations:** Legacy `PointLight.distance` falloffs are intercepted and swapped/commented in favor of `energy`.
- **Animation 2.0 / Slotted Actions:** Blender 4.3+ removed `Action.fcurves`. The agent prompt explicitly bans direct `.fcurves` access, and the safety net neutralizes any hallucinated attempts.

## Project structure

```
server.ts          Express app: static hosting + /api routes + Stripe webhook
auth.ts            Email/password helpers, JWT sign/verify, requireAuth middleware
db.ts              MySQL pool, table init, user/account CRUD helpers
src/               React frontend (App, components, api client, types)
  components/      SignUp, Dashboard, EditMemory, RequestMemory, AdminRequestPanel, ...
blender-worker/    Standalone Express + Docker microservice for running Blender scripts
dist/              Build output (vite assets + server.cjs)
.env.example       Documented environment variables
```

## Environment variables

Set these in Hostinger (Website → Environment variables) for production, or in `.env.local` for local dev. See `.env.example` for the full list.

| key | purpose |
| --- | --- |
| `JWT_SECRET` | Secret for signing session tokens (long random string, ≥16 chars) |
| `ADMIN_KEY` | Internal row key for the seeded admin account (any short string, e.g. `admin`). Not secret. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin login credentials. Admins log in through the normal login screen. |
| `GEMINI_API_KEY` | Google Gemini / Imagen / Veo API access |
| `APP_URL` | Public site URL (e.g. `https://mypets.cc`) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe Checkout + webhook verification |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL connection |
| `GOOGLE_MAPS_API_KEY_SERVER` | Server‑side Street View (IP‑restricted key) |
| `VITE_GOOGLE_MAPS_API_KEY_BROWSER` | Browser Maps/Places (HTTP‑referrer‑restricted key) |
| `MEDIA_BUCKET_NAME` / `MEDIA_BUCKET_URL` / `MEDIA_BUCKET_KEY` / `MEDIA_BUCKET_SECRET` | Object storage for generated media |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Twilio SMS API for request fulfillment notifications |
| `TRIPO_API_KEY` | Tripo3D API key for Image-to-3D mesh generation (Primary 3D engine) |
| `HEYGEN_API_KEY` / `HEYGEN_DEFAULT_VOICE_ID` | HeyGen API for talking avatar video generation |
| `BLENDER_WORKER_URL` | URL to the separate blender microservice (e.g. `https://pawsmemories.onrender.com/render`) |
| `WORKER_SHARED_SECRET` | Secret key for blender-worker auth |

> **Hostinger note:** set `DB_HOST` to `127.0.0.1`, not `localhost`. On Node 18+, `mysql2` resolves `localhost` to IPv6 (`::1`), which the Hostinger MySQL user grant does not cover — causing `Access denied … @'::1'`. Forcing IPv4 with `127.0.0.1` resolves it.

## Running locally

Prerequisites: Node.js 22 and a reachable MySQL database.

```bash
npm install          # install dependencies
# populate .env.local from .env.example
npm run dev          # start the Express + Vite dev server (tsx server.ts)
```

Other scripts:

```bash
npm run build        # vite build + bundle server.ts -> dist/server.cjs
npm start            # run the production bundle (node dist/server.cjs)
npm run lint         # type-check with tsc --noEmit
```

## Deployment

The app is deployed on Hostinger and rebuilds automatically whenever the `main` branch is updated on GitHub. The build runs `npm run build`, and the server starts from `dist/server.cjs`, reading `PORT` from the environment. No manual deploy step is required — push to `main` and Hostinger redeploys.
