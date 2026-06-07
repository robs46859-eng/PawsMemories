# Paws & Memories

Turn your pet photos into magical claymation, sketch, and artistic digital heirlooms — guided by Randy, an AI assistant. Paws & Memories is a full‑stack web app with email + password sign‑in, a credits system, AI image generation, and the option to order a physical printed photo album.

Live site: https://mypets.cc

## Tech stack

- **Frontend:** React 19 + Vite 6, Tailwind CSS 4, Lucide icons, Motion for animation
- **Backend:** Node 22 + Express 4 (single `server.ts`, bundled to `dist/server.cjs` with esbuild)
- **Auth:** Email + password with JWT session tokens (passwords hashed with scrypt)
- **Database:** MySQL (via `mysql2`) for the user store
- **AI:** Google Gemini for chat (`@google/genai`), Imagen for stills, Veo for video
- **Payments:** Stripe Checkout (physical album orders + credit packs) with webhook verification
- **Hosting:** Hostinger, auto‑deployed from the `main` branch on every GitHub push

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
| `profile_complete` | `0` / `1` |
| `is_admin` | `0` / `1` |
| `created_at` | timestamp |

> The legacy Twilio/phone verification flow has been removed. The `phone` column is now just a stable internal key per user.

## Project structure

```
server.ts          Express app: static hosting + /api routes + Stripe webhook
auth.ts            Email/password helpers, JWT sign/verify, requireAuth middleware
db.ts              MySQL pool, table init, user/account CRUD helpers
src/               React frontend (App, components, api client, types)
  components/      SignUp, Dashboard, EditMemory, OrderAlbumModal, RandyChat, ...
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
