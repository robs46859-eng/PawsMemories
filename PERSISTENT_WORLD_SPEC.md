# Pawsome3D — Persistent World Spec
**Feature codename: PawWorld**
**Version:** 0.1 draft — 2026-07-21

---

## 1. Vision

PawWorld is a geo-anchored, persistent multiplayer map where every 3D pet model
built inside Pawsome3D has a home, a social life, and a reason to come back
daily. The map is divided into regional districts, each with its own biome,
culture, and timed community events. Pets roam freely within their licensed
district but cannot cross segment boundaries without an upgrade — enforced by
a digital "geo-fence collar" that provides a gentle in-world nudge (buzz
animation + boundary glow) rather than a hard wall, keeping immersion intact
while driving district-upgrade purchases.

Core retention loop:
**Daily login → check pet status + world events → engage (adopt, upgrade,
socialise) → earn district XP → unlock next tier → repeat.**

---

## 2. Map Architecture

### 2.1 Regional Districts

The map is a stylised world rendered in the app's existing React-Three-Fiber
scene. Each district is a self-contained hex-tile cluster (~9–25 tiles).

| Tier | District name (examples) | Unlock | Capacity |
|------|--------------------------|--------|----------|
| 0 – Starter | Bone Yard, Kitten Creek | Free (all users) | 1 pet |
| 1 – Neighbourhood | Pawsbury, Meowtopia | 10 district XP | 3 pets |
| 2 – Town | Furville, Tabbytown | 40 XP or 8 credits | 8 pets |
| 3 – City | Barkshire Metro, Velvet Bay | 120 XP or 20 credits | 20 pets |
| 4 – Metropolis | New Pawrk, Catropolis | 300 XP or 50 credits | unlimited |

Users start in a free Tier-0 district assigned by their registered ZIP code
(geo-cluster via ZIP → lat/lng → Voronoi region assignment, stored in
`world_districts` table). Pets from the same real-world metro area share a
district by default, seeding organic social graphs.

### 2.2 Geo-Fence Collar ("Shock Collar" mechanic)

- Every pet has a `district_boundary` polygon stored server-side.
- When a pet's simulated position approaches the boundary (within 2 tiles),
  the collar asset on the 3D model plays a short buzz animation (shader
  pulse + haptic if mobile).
- Crossing requires either (a) earning the XP gate, (b) purchasing with
  credits, or (c) receiving a **District Passport** item from a social event.
- The boundary is enforced server-side (position updates are rejected outside
  the licensed zone); client shows the animation as feedback, not as the gate.
- Framing: the collar is a playful identity accessory (customisable skin,
  from the Wardrobe Wags line), not punitive — users can rename it
  ("Adventure Tag", "Explorer Chip").

---

## 3. Pet Placement & Free Roam

### 3.1 Home Plot

Each pet is assigned a **Home Plot** tile on first entry. The plot holds:
- A **Dog House / Cat Den** structure (upgradeable, see §4).
- A food bowl, water bowl, and 2 placeable objects (inventory from AvatarDashboard).
- A **welcome mat** displaying the pet's name + owner handle.

Plots are persistent across sessions; other users' pets can visit but not
modify a plot without the owner's consent.

### 3.2 Free-Roam Simulation

Between user sessions the pet AI (existing needs + behavior engine from
Phase 1/2) runs a lightweight server-side tick (every 15 minutes):
- Pet wanders within district, interacts with public amenities (park, cafe,
  fountain), and with other pets whose owners have enabled socialisation.
- Interactions generate **Social Moments** (short auto-generated clips using
  existing video pipeline) delivered to both owners on next login.
- Needs decay applies (hunger, water, energy) — owners who log in to feed
  earn +2 district XP per action, reinforcing daily return.

### 3.3 Offline Decay & Rescue Window

If a pet's needs drop to critical offline, it enters a **resting** state in
the world (visible to neighbours as a sleeping sprite). After 5 days of
no owner login it becomes **adoptable** (see §6). This is the primary
adoption driver and creates a visible, emotive cue for neighbours.

---

## 4. Dog House / Cat Den Upgrades

The home structure is the primary monetisation sink after district unlocks.
Upgrades are **timed purchases** — each tier takes real time to "build",
incentivising daily check-ins.

| Level | Name | Build time | Cost | New capability |
|-------|------|-----------|------|----------------|
| 1 | Starter Kennel / Cardboard Box | instant (free) | — | Single pet, 2 item slots |
| 2 | Cosy Cottage | 1 day | 4 credits | 2 pets, 4 items, weather shelter |
| 3 | Brick Bungalow | 2 days | 10 credits | 4 pets, 8 items, indoor/outdoor toggle |
| 4 | Paw Mansion | 3 days | 22 credits | 8 pets, 16 items, roof-deck social space |
| 5 | Grand Estate | 5 days | 50 credits | unlimited pets, event hosting (§5), custom exterior |

**Build mechanic:**
- User initiates upgrade, pays credits, structure shows scaffolding in-world.
- Other users can "help build" (contribute 1 district XP each) to reduce time
  by up to 20% — drives social engagement and map activity.
- Instant-complete available for 2 extra credits per remaining hour.

**Cosmetic DLC** (separate from structural upgrades):
- Themed exterior skins (Halloween Haunted House, Snow Chalet, Tropical Cabana).
- Signage, garden features, seasonal decorations — sourced from Wardrobe Wags
  "Home Edition" boxes.

---

## 5. Social Events

### 5.1 Event Types

| Event | Cadence | Trigger | Reward |
|-------|---------|---------|--------|
| **Bark in the Park** | Weekly (Saturdays) | Auto-scheduled per district | +5 XP, 1 district sticker |
| **Pup Cup Social** | Bi-weekly | Host with Level 3+ house | +8 XP, Social Moment clip |
| **Adoption Fair** | Monthly | Auto (when 3+ pets adoptable in district) | District Passport |
| **Seasonal Festival** | Quarterly | Platform-wide | Exclusive cosmetic, +20 XP |
| **Rescue Drive** | Ad hoc | Admin-triggered | Double XP weekend |

### 5.2 Hosting

- Users with a **Level 4+ structure** can host a Pup Cup Social.
- Host sends invites (push notification + in-app) to up to 20 neighbours.
- During the event window (2 hours), invited pets congregate at the host plot;
  the app renders a live scene with animated interactions.
- Host earns +15 XP + 1 Social Moment per attending pet (capped at 5 clips
  per event to respect video generation quotas).
- Non-host attendees earn +3 XP + 1 clip.

### 5.3 Event Scheduling (server side)

```
world_events table:
  id, district_id, event_type, starts_at, ends_at,
  host_avatar_id (nullable), status, reward_json, created_at
```

A cron job (`/api/world/events/schedule`, admin-only) runs nightly to
auto-create next week's Bark in the Park events for each active district.
Hosting events are created on demand via `POST /api/world/events` (auth, Level
4 house check).

---

## 6. Adoption — 5-Day Timed Release

### 6.1 Entering Adoption

A pet becomes **adoptable** when:
- Owner has not logged in for **5 consecutive days**, AND
- Pet's needs are critical (any stat < 10%), AND
- Owner did not set the "Away Mode" flag before their last login (Away Mode
  freezes needs decay for up to 14 days, costs 2 credits/week).

When triggered:
1. Owner receives an email + push: "Your pet is hungry and lonely — 24 hours
   to feed them before they're rehomed."
2. After 24-hour grace, pet status flips to `adoptable` in the DB.
3. Pet appears in the district **Adoption Fair** pool and on the global
   `/adopt` discovery feed.

### 6.2 Adoption Flow

1. Prospective adopter browses the Adoption Fair (filterable by species,
   breed, district, personality).
2. Taps "Meet [Pet Name]" — 30-second Social Moment clip plays (auto-generated
   from the pet's history).
3. Adopter submits an adoption request; original owner gets a final 48-hour
   notification.
4. If no owner response: adoption confirmed, pet's `user_phone` transfers,
   home plot migrates to adopter's district, original owner retains read-only
   memorial in their Fur Bin.
5. Adopter earns +10 district XP + "Rescue Hero" badge.

### 6.3 Ownership Transfer (server)

```
POST /api/world/adopt/:avatarId
  - Auth required
  - Checks: avatar status = 'adoptable', requester ≠ owner
  - Transfers: avatars.user_phone, home_plot.user_phone, all pet_health records
  - Creates: adoption_log entry (original owner, adopter, timestamp)
  - Grants: 10 XP to adopter, "Rescue Hero" badge
  - Notifies: both parties via email + push
```

---

## 7. Database Schema

```sql
-- World districts (geo-clustered by ZIP region)
CREATE TABLE world_districts (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(80) NOT NULL,
  tier          TINYINT NOT NULL DEFAULT 0,
  biome         ENUM('park','beach','forest','urban','snow','desert') NOT NULL DEFAULT 'park',
  center_lat    DECIMAL(10,7) NULL,
  center_lng    DECIMAL(10,7) NULL,
  boundary_json JSON NOT NULL COMMENT 'GeoJSON polygon for geo-fence enforcement',
  xp_to_unlock  INT NOT NULL DEFAULT 0,
  credit_unlock INT NULL,
  max_pets      INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Pet home plots (one per avatar per district)
CREATE TABLE world_home_plots (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  avatar_id       INT NOT NULL,
  user_phone      VARCHAR(32) NOT NULL,
  district_id     BIGINT NOT NULL,
  tile_x          SMALLINT NOT NULL,
  tile_y          SMALLINT NOT NULL,
  house_level     TINYINT NOT NULL DEFAULT 1,
  house_skin      VARCHAR(64) NULL,
  build_complete_at TIMESTAMP NULL COMMENT 'NULL = build in progress',
  item_slots_json JSON NOT NULL DEFAULT (JSON_ARRAY()),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_avatar_district (avatar_id, district_id),
  FOREIGN KEY (avatar_id) REFERENCES avatars(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- District membership (user ↔ district, with XP)
CREATE TABLE world_district_members (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_phone  VARCHAR(32) NOT NULL,
  district_id BIGINT NOT NULL,
  xp          INT NOT NULL DEFAULT 0,
  joined_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_member (user_phone, district_id)
) ENGINE=InnoDB;

-- Scheduled and live social events
CREATE TABLE world_events (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  district_id     BIGINT NOT NULL,
  event_type      ENUM('bark_in_park','pup_cup','adoption_fair',
                       'seasonal_festival','rescue_drive') NOT NULL,
  starts_at       TIMESTAMP NOT NULL,
  ends_at         TIMESTAMP NOT NULL,
  host_avatar_id  INT NULL,
  status          ENUM('scheduled','active','ended','cancelled') NOT NULL DEFAULT 'scheduled',
  reward_json     JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Geo-fence collar config per avatar
CREATE TABLE world_collars (
  avatar_id         INT NOT NULL PRIMARY KEY,
  collar_skin       VARCHAR(64) NULL DEFAULT 'default',
  collar_label      VARCHAR(60) NULL DEFAULT 'Adventure Tag',
  boundary_override JSON NULL COMMENT 'per-pet custom boundary; NULL = uses district',
  buzz_enabled      TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (avatar_id) REFERENCES avatars(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Adoption log
CREATE TABLE world_adoption_log (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  avatar_id        INT NOT NULL,
  from_user_phone  VARCHAR(32) NOT NULL,
  to_user_phone    VARCHAR(32) NOT NULL,
  district_id      BIGINT NOT NULL,
  adopted_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  grace_notified_at TIMESTAMP NULL,
  INDEX (avatar_id)
) ENGINE=InnoDB;
```

---

## 8. API Endpoints

```
GET  /api/world/district              — user's current district + XP + event schedule
GET  /api/world/district/:id/map      — tile grid + pet positions + active events
GET  /api/world/district/:id/members  — neighbour list with pet previews
POST /api/world/district/join         — assign user to a district (ZIP-based auto or manual)
POST /api/world/district/upgrade      — pay credits / check XP to move to next tier

GET  /api/world/plot                  — user's home plot + house level + build status
POST /api/world/plot/upgrade          — initiate house level upgrade (pays credits, starts timer)
POST /api/world/plot/help/:plotId     — contribute 1 XP to reduce neighbour's build time

GET  /api/world/events                — upcoming + active events for user's district
POST /api/world/events                — host a Pup Cup (Level 4+ house required)
POST /api/world/events/:id/join       — RSVP to an event
POST /api/world/events/schedule       — (admin) auto-create next week's events

GET  /api/world/adopt                 — global adoptable pets feed
GET  /api/world/adopt/:avatarId       — pet adoption detail + Social Moment clip
POST /api/world/adopt/:avatarId       — submit adoption request
POST /api/world/away-mode             — activate/deactivate Away Mode (freeze needs decay)

GET  /api/world/collar/:avatarId      — collar config
PATCH /api/world/collar/:avatarId     — update skin/label/buzz setting
```

---

## 9. Retention Mechanics Summary

| Mechanic | Return trigger | Cadence |
|----------|---------------|---------|
| Needs decay (food/water/energy) | Daily feeding loop | Daily |
| Build timer on house upgrade | Check build progress | 1-5 days |
| Weekly Bark in the Park | Event participation | Weekly |
| Adoption Fair threat | Feed pet before 5-day abandonment | Irregular (powerful) |
| Social Moments from neighbours | Curiosity / social obligation | Whenever generated |
| Seasonal Festival | Exclusive cosmetic scarcity | Quarterly |
| District XP milestones | Progress bar completion | Ongoing |
| "Help Build" neighbour requests | Social reciprocity | Whenever a neighbour upgrades |

---

## 10. Monetisation

| Revenue line | Mechanism |
|-------------|-----------|
| District unlocks | Credits (Tier 2-4) |
| House level upgrades | Credits per level |
| Instant-complete build | 2 cr/hr |
| Away Mode | 2 cr/week |
| Cosmetic skins (house, collar) | Credits or Wardrobe Wags box |
| District Passport (cross-district visit pass) | Earned at events OR purchased |
| Adoption Fair listing boost | Optional credits to surface pet higher in feed |

---

## 11. Tech Stack Notes

- **Map render:** existing R3F scene (`AnimatorScreen` canvas reused or a new
  `WorldMapScreen.tsx`); hex-tile geometry generated procedurally (instanced
  meshes, LOD-swapped at distance).
- **Pet position:** server-managed (15-min tick cron); client fetches tile
  positions on load + WebSocket push for live events. No real-time physics in
  the shared world — positions are discrete tile coords.
- **Geo-fence enforcement:** server validates tile coords against the district
  boundary polygon (`@turf/boolean-point-in-polygon` or simple bounding box for
  MVP); client plays collar animation on boundary approach.
- **Social Moments:** reuse the existing Gemini/HeyGen video pipeline;
  triggered server-side during event processing, delivered as push + in-app
  notification.
- **Away Mode:** a boolean + timestamp column on `avatars`; needs-decay cron
  skips pets where away_until > NOW().

---

## 12. Build Phases

| Phase | Scope | Est. complexity |
|-------|-------|----------------|
| **PW1** | DB schema, district assignment (ZIP→region), home plot init, collar config | Medium |
| **PW2** | Map render (WorldMapScreen), tile grid, pet placement, free-roam tick | High |
| **PW3** | House upgrades (timer, help-build), district XP + unlock gates | Medium |
| **PW4** | Social events (scheduling, hosting, RSVP, Social Moments delivery) | High |
| **PW5** | Adoption system (5-day trigger, fair feed, transfer flow, Away Mode) | Medium |
| **PW6** | Monetisation hooks (District Passports, cosmetic DLC, instant-complete) | Low |
| **PW7** | Seasonal content pipeline, admin event scheduler, analytics dashboard | Medium |

PW1-PW3 are the minimum viable world. PW4-PW5 unlock the core retention loops.
PW6-PW7 are revenue and ops hardening.
