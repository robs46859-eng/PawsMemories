# Paws & Memories

Turn your pet photos into magical claymation, sketch, and artistic digital heirlooms — guided by Randy, an AI assistant. Paws & Memories is a full‑stack web app with phone‑based sign‑in, a credits system, AI image generation, and the option to order a physical printed photo album.

Live site: https://mypets.cc

## Tech stack

- **Frontend:** React 19 + Vite 6, Tailwind CSS 4, Lucide icons, Motion for animation
- **Backend:** Node 22 + Express 4 (single `server.ts`, bundled to `dist/server.cjs` with esbuild)
- **Auth:** Twilio Verify (SMS one‑time codes) + JWT session tokens
- **Database:** MySQL (via `mysql2`) for the user store
- **AI:** Google Gemini (`@google/genai`)
- **Payments:** Stripe Checkout (physical album orders) with webhook verification
- **Hosting:** Hostinger, auto‑deployed from the `main` branch on every GitHub push

## How it fits together

The Express server does double duty: it serves the built Vite frontend from `dist/` and exposes the JSON API under `/api`. Authentication is a three‑step phone flow — request a code, verify it, then complete a profile — after which the user receives a JWT that gates the rest of the app.

### Auth & gating flow

1. `POST /api/auth/send-code` — normalizes the phone number and sends an SMS code via Twilio Verify.
2. `POST /api/auth/verify-code` — checks the code with Twilio. On success, the user is created (or fetched) in MySQL and a 30‑day JWT is returned. New users start with a profile‑incomplete record.
3. `POST /api/auth/complete-profile` — saves name + email and grants **50 free credits** the first time the profile is completed.
4. `GET /api/me` — restores the current user from a valid `Bearer` token.

Protected routes use the `requireAuth` middleware, which rejects any request without a valid session token.

### Database

A single `users` table is created automatically on boot (`initDb()`):

| column | notes |
| --- | --- |
| `id` | auto‑increment primary key |
| `phone` | unique, E.164 format |
| `full_name`, `email` | filled in at profile completion |
| `credits` | starts at 0, +50 on first profile completion |
| `profile_complete` | `0` / `1` |
| `created_at` | timestamp |

## Project structure

```
server.ts          Express app: static hosting + /api routes + Stripe webhook
auth.ts            Twilio Verify helpers, JWT sign/verify, requireAuth middleware
db.ts              MySQL pool, users table init, user CRUD helpers
src/               React frontend (App, components, api client, types)
  components/      SignUp, Dashboard, EditMemory, OrderAlbumModal, RandyChat, ...
dist/              Build output (vite assets + server.cjs)
.env.example       Documented environment variables
```

## Environment variables

Set these in Hostinger (Website → Environment variables) for production, or in `.env.local` for local dev. See `.env.example` for the full list.

| key | purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google Gemini API access |
| `APP_URL` | Public site URL (e.g. `https://mypets.cc`) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe Checkout + webhook verification |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account credentials |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service (`VA…`) |
| `JWT_SECRET` | Secret for signing session tokens |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL connection |

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
