# Paws & Memories — Complete UI Map

**Site:** https://mypets.cc  
**Repo:** robs46859-eng/pawsmemories  
**Host:** Hostinger (auto-deploy from `main`)  
**Stack:** React 19 + Vite 6 + Tailwind CSS 4 / Express 4 + Node 22 / MySQL / Gemini AI / Stripe / Twilio

---

## Architecture Overview

Single-page React app served by Express (`server.ts`). No client-side router — screen state is managed by a `Screen` enum in `App.tsx`. All navigation is programmatic via `setCurrentScreen()`.

```
SIGN_UP → WELCOME → TUTORIAL → DASHBOARD
                         ↘ EDIT_MEMORY → SHARE_MEMORY → DASHBOARD
```

---

## Screen Inventory

| # | Screen | Enum Value | Component | Entry Route | Exit Route |
|---|--------|------------|-----------|-------------|------------|
| 1 | Sign Up | `SIGN_UP` | `SignUp.tsx` | App mount / logout | → WELCOME (new user), → TUTORIAL (returning), → DASHBOARD (verified returner) |
| 2 | Welcome | `WELCOME` | `Welcome.tsx` | After sign-up (new user) | → TUTORIAL |
| 3 | Tutorial | `TUTORIAL` | `Tutorial.tsx` | After welcome or first login | → DASHBOARD |
| 4 | Dashboard | `DASHBOARD` | `Dashboard.tsx` | After tutorial, login, back-nav | → EDIT_MEMORY (click creation), → SIGN_UP (logout) |
| 5 | Edit Memory | `EDIT_MEMORY` | `EditMemory.tsx` | Dashboard → click creation | → SHARE_MEMORY (after upload or transform) |
| 6 | Share Memory | `SHARE_MEMORY` | `ShareMemory.tsx` | After edit/transform | → DASHBOARD |

---

## Deep-Dive: Each Screen

### 1. SIGN_UP (`SignUp.tsx`)

**Purpose:** Phone-based auth with OTP verification + profile completion.

**Sub-steps (internal state machine, not screens):**

| Step | State | UI Elements | API Calls |
|------|-------|-------------|-----------|
| A | `phone` | Phone input field, "Send Code" button, shield-check icon, error display | `POST /api/auth/send-code` |
| B | `code` | 6-digit code input, "Verify" button, resend link, error display | `POST /api/auth/verify-code` |
| C | `profile` | Full name input, email input, "Complete Profile" button | `POST /api/auth/complete-profile` |

**Key props received:** `onAuthenticated(user: PublicUser, isNew: boolean)`  
**Key behaviors:**
- Stores JWT token in `localStorage`
- New users get 50 free credits on profile completion
- `isNew=true` → go to WELCOME screen
- `isNew=false` + `profileComplete=false` → go to TUTORIAL
- `isNew=false` + `profileComplete=true` → go to DASHBOARD
- Uses `motion` for step transitions

**Visual design:** Centered card, ambient glow backgrounds, primary green theme, Lucide icons for each step.

---

### 2. WELCOME (`Welcome.tsx`)

**Purpose:** Onboarding greeting with Randy (AI golden retriever mascot).

**UI Elements:**
- Large circular avatar (Randy the clay dog portrait) with "AI Guide" badge
- Greeting text: "Hi {name}, I'm Randy."
- Description: "I'll show you how to turn your pet photos into magic..."
- Feature highlights with icons:
  - ShieldCheck → "Your memories are private and safe"
  - Sparkles → "AI-powered transformations"
- "Get Started" button with ArrowRight icon
- "Back" link to return to SignUp
- Background ambient glow effects

**Key props:** `userName`, `onNext`, `onBackToSignUp`

**Visual design:** Full-height centered card, soft-float animation on avatar, glowing shadow.

---

### 3. TUTORIAL (`Tutorial.tsx`)

**Purpose:** One-time walkthrough showing app capabilities with sample data.

**UI Elements:**
- Progress bar showing "Tutorial Complete 100%"
- Hero showcase frame: large image (Randy at Grand Canyon) with overlay
  - Top badge: "Sample Creation" with Sparkles icon
  - Bottom label: "Grand Canyon National Park" with MapPin
- Feature cards with icons:
  - Award → Achievements & streaks
  - ImageIcon → Transform photos
  - MapPin → Location backdrops (Street View)
  - Sparkles → AI art styles
  - Navigation → Randy AI guide
- "Start Creating" button → goes to DASHBOARD

**Visual design:** Full-height scrollable page, cinematic hero image, clean icon cards.

---

### 4. DASHBOARD (`Dashboard.tsx`) — Main App Screen (794 lines)

**Purpose:** Hub for all user activity. Contains the most UI surface area.

#### Section A: Welcome & Daily Bonus (3-col grid)

| Component | Layout | Details |
|-----------|--------|---------|
| Welcome Banner | `md:col-span-2` | "Hello, {firstName}!" greeting, "X pending memories" text, primary-container background, plant emoji decoration |
| Daily Login Card | `col-span-1` | Award icon, "+5cr" reward text, "Claim Reward" / "Claimed" button, streak counter |

#### Section B: Featured Bento CTAs (2-col grid)

| Card | Action | Cost |
|------|--------|------|
| "New Memory" — hero image background with gradient overlay, "Premium AI" badge | `onAddMemory` → EDIT_MEMORY screen | 40cr |
| "New Album" — card with FolderPlus icon, input modal for album name | `handleCreateAlbum` → modal with album name input | 10cr |

**New Album Modal:**
- Fixed overlay, centered card
- Input: "e.g. Daisy's Roadtrip"
- Cancel / Create Album buttons
- Currently shows `alert()` on create (no backend persistence yet)

#### Section C: Social Sharing Banner

- Dashed border container with Share2 icon "Earn 10cr" badge
- Two buttons: "TikTok" (Video icon), "Instagram" (Camera icon)
- Calls `onShareCompleted(platform, 10)` on click

#### Section D: Live Pet Inspiration Board

- Large two-column section pulling from public APIs (`dog.ceo`, `dogapi.dog`)
- Left column: fetched pet image (aspect-[4/3]) with breed badge overlay, URL trace bar
- Right column: "Live Fun Fact" bubble, loading skeleton states
- Controls:
  - "Simulate Network Error: On/Off" toggle
  - "Refresh Feed" button with spinner
- Error notification block (red) when fetch fails
- Diagnostics panel (expandable): dark terminal-style, shows endpoint status (dog.ceo, dogapi.dog), URLs, error logs, network strategy description
- API endpoint: `GET /api/inspiration` (server-side proxy)

#### Section E: Achievements Panel

- Rendered via `AchievementsPanel.tsx` component
- Shows daily streak + achievement list
- Claim rewards button per achievement

#### Section F: Two-column grid — Albums + Creations

**My Albums (left column):**
- Header: "My Albums" + "View All →" link
- 2-column grid of album cards
  - Square image thumbnails
  - "X Items" badge overlay
  - Album name below image
- Info badge: "You can access all {count} albums inside the Albums tab below."

**AI Creations (right column):**
- Header: "AI Creations" + "Full Gallery →" link
- Vertical list of up to 4 creation cards
  - Each card: thumbnail (80x80), date, creation name, style badge, location badge
  - Video indicator (Play icon) if `media_type === "video"`
  - "Animate (250cr)" button for still images
  - "Queued..." / "Rendering..." spinner during async video job
- Instructions banner: "Configure different environments inside the Creations styles tab..."

**Animate Memory Modal (Phase 4):**
- Fixed overlay, centered card
- Radio group with 4 motion presets:
  - "Gentle breeze, subtle tail wag, cinematic lighting"
  - "Slow cinematic push-in, dreamy atmosphere"
  - "Snow falling softly, cozy winter vibe"
  - "Playful head tilt, happy and energetic"
- "Include Audio" toggle switch
- "Animate (250cr)" confirmation button
- Calls `POST /api/create-video`, polls `GET /api/jobs/:id` every 5s

**Video Job Polling:**
- `animatingJobs` state tracks active jobs per creation
- `startPolling()` sets up `setInterval` at 5s
- On `done`: reloads page to pick up new `video_url`
- On `failed`: alerts error message

---

### 5. EDIT_MEMORY (`EditMemory.tsx`)

**Purpose:** Upload pet photo, choose AI style + backdrop, transform into memory.

**UI Elements (based on code structure):**
- Photo upload area (drag-drop or click to browse)
- Style selector: Realistic / Sketch / Clay / Artistic
- Backdrop selector: preset backgrounds OR Street View location picker
- Location Picker: `LocationPicker.tsx` modal component
  - Google Maps Autocomplete for place search
  - Street View Panorama for POV selection (heading, pitch, fov)
  - "My Favorite Location" label input
  - Confirm/Cancel buttons
- "Transform" button → calls Gemini image generation
- Credit cost display (40cr for still, 250cr for video)
- Live preview area

**API Calls:**
- Image upload → base64 or blob to server
- `POST /api/generate-image` (via Gemini `gemini-2.5-flash-image`)
- `POST /api/create-video` (via Veo API, async)
- `GET /api/jobs/:id` for job polling

**Flow:** Upload → Style → Backdrop → Transform → → SHARE_MEMORY

---

### 6. SHARE_MEMORY (`ShareMemory.tsx`)

**Purpose:** Post-transform screen — share, order physical album, or return to dashboard.

**UI Elements:**
- Generated image display (large)
- Share buttons (social platforms)
- "Order Physical Album" → opens `OrderAlbumModal`
- "Back to Dashboard" button

---

### 7. Order Album Modal (`OrderAlbumModal.tsx`)

**Purpose:** Checkout flow for physical printed photo album.

**UI Elements:**
- Fixed overlay, centered card
- Order summary: creation image, style, credit cost (800cr), cash ($12.00)
- Affordability check: `canAfford = userCredits >= 800`
- Shipping form:
  - Name, Address, City, State, ZIP, Country inputs
  - Credit card icon, truck icon decoration
- Submit → `POST /api/create-checkout-session`
- Redirects to Stripe Checkout URL on success
- Error display for failed checkout
- Loading state with spinner

---

### 8. Randy Chat (`RandyChat.tsx`)

**Purpose:** Floating AI chat widget for in-app help.

**UI Elements:**
- Floating action button (MessageSquare icon) bottom-right
- Chat panel slides open:
  - Welcome message from Randy
  - Message list with user/model roles
  - Text input + Send button
  - Microphone toggle for voice input (Web Speech API)
  - Voice-to-text appends to input
  - `Volume2` text-to-speech button for reading responses
- Achievement unlock triggers (e.g., `voice_use`)
- Backend: calls AI chat API via `authedFetch`

---

### 9. Credit Store (`CreditStore.tsx`)

**Purpose:** Modal for purchasing credits (appears when user can't afford an action).

**UI Elements:**
- Modal overlay
- Credit packages / purchase options
- Stripe integration for payment
- Success/error messaging

---

### 10. Achievements Panel (`AchievementsPanel.tsx`)

**Purpose:** Gamification system — daily streaks + achievement badges.

**Built-in Achievements (from App.tsx):**

| ID | Title | Reward | Condition |
|----|-------|--------|-----------|
| `pioneer` | Pioneer Parent | 25cr | Complete profile registration |
| `camera_use` | (photo-related) | TBD | Take/upload a photo |
| `voice_use` | (voice-related) | TBD | Use speech recognition |

**UI Elements:**
- Streak counter with claim button
- Achievement cards with icons, titles, descriptions
- Claim reward buttons per unlocked achievement
- Locked/unlocked visual states

---

## Global UI Elements

### App Shell (`App.tsx`)

| Element | Description |
|---------|-------------|
| Dark mode toggle | `Sun/Moon` icons, persisted to `localStorage("paws_dark_mode")` |
| Top bar | User icon, History icon, Credit display, theme toggle, Logout |
| Credit display | Shows `userProfile.credits`, click opens CreditStore modal |
| Logout | Clears token, resets to SIGN_UP screen |
| Order success modal | Shows after Stripe checkout success with `successOrderSessionId` |

### Data Layer

| Source | Type | Description |
|--------|------|-------------|
| `DEFAULT_ALBUMS` | `src/data.ts` | 2 hardcoded albums (Bailey, Summer Adventures) |
| `DEFAULT_CREATIONS` | `src/data.ts` | 4+ hardcoded sample creations with Google-hosted images |
| `localStorage` | Client | `paws_streak`, `paws_streak_claimed_today`, `paws_achievements_state`, `paws_dark_mode`, auth token |
| MySQL | Server | `users` table (phone, full_name, email, credits, profile_complete) |
| MySQL | Server | `creations` table (image/video generation results) |
| MySQL | Server | `generation_jobs` table (async Veo job tracking) |

### Design System

**Color Palette (from `index.css` @theme):**
- Primary: `#4a6545` (sage green) / Dark: `#a8c69f`
- Primary container: `#a8c69f` / Dark: `#334e2f`
- Secondary: `#964826` (warm terracotta) / Dark: `#ff9d76`
- Secondary container: `#fd9a71` / Dark: `#5c240b`
- Surface: `#fff8f3` (warm cream) / Dark: `#0f172a` (slate)
- Error: `#ba1a1a`

**Custom CSS Classes:**
- `.soft-glow-shadow` — subtle green-tinted elevation shadow
- `.glowing-shadow-sage` — sage glow for prominent cards
- `.shimmer-button` — animated shimmer overlay effect
- `.soft-float` — floating animation
- `.animate-fade-in`, `.animate-slide-down` — motion transitions

**Typography:**
- Sans: Plus Jakarta Sans (400–800 weights)
- Mono: JetBrains Mono (400–500)

---

## Backend API Routes (from `server.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/send-code` | No | Send Twilio OTP to phone |
| POST | `/api/auth/verify-code` | No | Verify OTP, return JWT + user |
| POST | `/api/auth/complete-profile` | Yes | Save name+email, grant 50cr |
| GET | `/api/me` | Yes | Restore session from JWT |
| POST | `/api/logout` | Yes | Invalidate token |
| POST | `/api/generate-image` | Yes | Gemini AI image transform |
| POST | `/api/create-video` | Yes | Start Veo video generation |
| GET | `/api/jobs/:id` | Yes | Poll async job status |
| POST | `/api/create-checkout-session` | Yes | Stripe checkout for album |
| POST | `/api/stripe-webhook` | No | Stripe payment callback |
| GET | `/api/creations` | Yes | Fetch user's creations |
| GET | `/api/inspiration` | No | Public pet fact + image proxy |
| POST | `/api/credits/claim-daily` | Yes | Claim daily 5cr bonus |
| POST | `/api/credits/purchase` | Yes | Credit store purchase |
| GET | `/api/credits/balance` | Yes | Check credit balance |
| PUT | `/api/creations/:id` | Yes | Update creation metadata |

---

## Component Hierarchy

```
App.tsx
├── SignUp.tsx
│   └── Phone input → Code input → Profile form (3-step state machine)
├── Welcome.tsx
│   └── Randy avatar + greeting + feature highlights
├── Tutorial.tsx
│   └── Hero image + feature cards + progress bar
├── Dashboard.tsx
│   ├── Welcome banner + Daily login card
│   ├── New Memory CTA card
│   ├── New Album CTA card (+ Create Album modal)
│   ├── Social sharing banner (TikTok, Instagram)
│   ├── Live Pet Inspiration Board
│   │   ├── Pet image from API
│   │   ├── Fact bubble
│   │   ├── Simulate Error toggle
│   │   └── Diagnostics panel
│   ├── AchievementsPanel.tsx
│   ├── Albums grid
│   ├── Creations list
│   │   └── Animate Memory modal (motion presets + audio toggle)
│   └── RandyChat.tsx (floating)
├── EditMemory.tsx
│   ├── Photo upload
│   ├── Style selector (4 styles)
│   ├── Backdrop selector (presets + Street View)
│   └── LocationPicker.tsx (Google Maps + Street View POV)
├── ShareMemory.tsx
│   └── Generated image + share options + Order Album link
├── OrderAlbumModal.tsx (modal)
│   └── Shipping form + Stripe checkout redirect
├── CreditStore.tsx (modal)
│   └── Credit purchase options
└── AchievementsPanel.tsx
    └── Streak + achievement cards
```

---

## File Manifest

| File | Lines | Purpose |
|------|-------|---------|
| `server.ts` | ~1400 | Express server: API routes, Stripe webhook, AI generation |
| `auth.ts` | ~85 | Twilio + JWT auth helpers, requireAuth middleware |
| `db.ts` | ~350 | MySQL pool, user CRUD, creation/job tables |
| `storage.ts` | ~80 | S3/object storage upload helper |
| `src/App.tsx` | ~600 | Root app: screen state, auth gating, theme, credit store |
| `src/main.tsx` | ~11 | React DOM entry point |
| `src/types.ts` | ~95 | TypeScript interfaces (Screen, Creation, Album, UserProfile, etc.) |
| `src/data.ts` | ~200 | Hardcoded sample albums and creations |
| `src/api.ts` | ~150 | Frontend API client (auth, fetch helpers, video/job endpoints) |
| `src/index.css` | ~120 | Tailwind theme tokens, custom CSS classes |
| `src/components/SignUp.tsx` | ~400 | 3-step auth flow component |
| `src/components/Welcome.tsx` | ~120 | Onboarding greeting screen |
| `src/components/Tutorial.tsx` | ~150 | Tutorial walkthrough screen |
| `src/components/Dashboard.tsx` | 794 | Main hub screen (largest component) |
| `src/components/EditMemory.tsx` | TBD | Photo transform editor |
| `src/components/ShareMemory.tsx` | TBD | Share/order post-transform screen |
| `src/components/RandyChat.tsx` | ~300 | Floating AI chat widget |
| `src/components/LocationPicker.tsx` | ~200 | Google Maps + Street View POV picker |
| `src/components/OrderAlbumModal.tsx` | ~400 | Physical album checkout modal |
| `src/components/CreditStore.tsx` | TBD | Credit purchase modal |
| `src/components/AchievementsPanel.tsx` | TBD | Gamification/achievements display |
| `package.json` | 45 | Dependencies and scripts |
| `vite.config.ts` | 20 | Vite + Tailwind config |
| `tsconfig.json` | 20 | TypeScript config |

---

## State Flow Summary

```
[App Mount]
  └─ Check localStorage token
     └─ Valid? → GET /api/me
        └─ Profile complete? → DASHBOARD
        └─ Profile incomplete? → TUTORIAL
     └─ No token? → SIGN_UP

[SIGN_UP]
  └─ Phone → send-code → Code input → verify-code → JWT stored
     └─ New user? → profile form → complete-profile → WELCOME
     └─ Returning (+ profile complete) → DASHBOARD
     └─ Returning (+ profile incomplete) → TUTORIAL

[WELCOME] → TUTORIAL
[TUTORIAL] → DASHBOARD

[DASHBOARD]
  └─ "New Memory" → EDIT_MEMORY
  └─ Click creation → EDIT_MEMORY (edit existing)
  └─ "Animate" → create-video → poll job → reload
  └─ Daily claim → POST /api/credits/claim-daily
  └─ Share → onShareCompleted callback → credit reward
  └─ Logout → clear token → SIGN_UP

[EDIT_MEMORY]
  └─ Upload photo → choose style → choose backdrop → Transform
     └─ POST /api/generate-image → success → SHARE_MEMORY
  └─ Location Picker modal → Google Maps autocomplete → Street View POV
  └─ "Animate" → POST /api/create-video → async → job polling

[SHARE_MEMORY]
  └─ "Order Album" → OrderAlbumModal → Stripe Checkout redirect
  └─ "Back to Dashboard" → DASHBOARD
```
