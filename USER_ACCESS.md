# User Access Map

Every module and feature reachable by a **standard (non-admin)** account, and how
to get there. For admin-only surfaces see **ADMIN_ACCESS.md**.

---

## 1. Signed out

A visitor who hasn't logged in sees only:

| Page | Route |
|---|---|
| Sign up / sign in | `/sign-up` |
| Password reset | `/reset-password` |
| Privacy policy | `/legal/privacy` |
| Terms of service | `/legal/terms` |

Plus the SEO landing pages, which are public:

| Page | Route |
|---|---|
| 3D pet models | `/3d-pet-models` |
| Custom dog figurines | `/custom-dog-figurines` |
| Pet memorial models | `/pet-memorial-models` |
| How it works | `/how-it-works` |
| Pricing | `/pricing` |

**The product navigation does not render when signed out.** The header shows the
logo and a theme toggle only — the four icons appear after authentication
(enforced at `App.tsx`, covered by `tests/shell_layout_contract.test.mjs`).

---

## 2. The global shell

Once signed in, every screen carries the same header:

- **Left:** Pawsome3D logo → returns to the dashboard
- **Right:** four stencil icons, then a `⋯` overflow menu

| Icon | Goes to | Route |
|---|---|---|
| ⊕ Create | Create flow | `/create` |
| ⌂ Marketplace | Browse models | `/marketplace` |
| 🐾 Pawprints | Pawprint studio | `/pawprints` |
| 👤 Profile | Account | `/profile` |

**Overflow menu (`⋯`):** Buy PupCoins, Shop, Community, Pet Health, light/dark
mode, Help & Support, Log out. (Admins additionally see Wags admin and
Marketplace admin here.)

**Mobile:** a five-column bottom bar replaces the sidebar — Home, Fur Bin,
Marketplace, Wags, Profile.

---

## 3. Creating a model

Route: `/create` → `/create/reference` → `/create/customize` → `/create/validate`
→ `/create/checkout`

**Step 1 — Subject.** Choose *From a photo* or *From a description*.

- **From a photo** — upload JPG/PNG/WebP up to 10 MB (auto-downscaled to 2048px)
- **From a description** — type up to 500 characters

Then pick the subject type, which decides the rig skeleton:

| Option | Rig |
|---|---|
| Dog / Cat / Other | Four-legged |
| **Person** | Two-legged, with arms and hands |
| Bird | Winged |
| Small pet | Rabbit, guinea pig, ferret |

**Step 2 — Concept.** An AI reference image is generated for approval. Re-roll if
it isn't right. No PupCoins are charged until checkout.

**Step 3 — Customize.** Style, pose, and the paid add-ons:

| Add-on | Cost | Notes |
|---|---|---|
| Rig for animation | +20 | Skeleton with automated quality checks |
| Facial rig | +20 | **Early access.** Requires the rigging add-on. Depends on the model returning usable mouth shapes — if it can't be applied you still get jaw movement, and this add-on is charged either way and is not refunded. The warning appears when you tick the box. |

**Step 4 — Validate.** Printability and structural checks.

**Step 5 — Checkout.** PupCoins are deducted here.

> If rigging fails its quality gates you still receive the static model, and the
> rigging PupCoins are automatically refunded.

**Model cap:** 5 models per account (`MODEL_CAP`). Delete one to create another.

---

## 4. Fido's Styles — `/fidos-styles`

The 3D editing suite. Left rail tools:

| Tool | What it does |
|---|---|
| **Looks** | AI-generated style variations |
| **Wardrobe** | Attach accessories to the model |
| **Coat** | *Coming soon* — points you to Texture repair |
| **Texture repair** | Re-bake the coat from your own approved photos. Free — it repairs what you already paid to create. Shows how much the colour match improved, and the original is always recoverable via *Use original*. |
| **Lighting** | Scene lighting presets |
| **Surface** | Material properties |
| **Voice** | Voice clone assets |

---

## 5. Pawprints — `/pawprints`

Themed cards and art featuring your pet.

**Categories:** grieving/loss, new puppy, veterinarian thank-you,
holiday/birthday, travel postcard, pet business, environment.

**Layouts:** portrait card, landscape postcard, photo-top, framed quote.

Physical prints are available where a Printful product is configured. Orders are
always drafted first and only confirmed after Stripe reports a paid checkout.

---

## 6. Marketplace — `/marketplace`

Browse and buy published 3D models.

- Browse listings with previews
- Purchase a digital model — one-time card payment via Stripe Checkout
- Your entitlement is granted by the **payment webhook**, not the redirect, so
  closing the tab won't lose a purchase
- Download via a short-lived signed URL after purchase
- Re-attempting a checkout with the same key resumes the existing session rather
  than charging twice

> **Selling is not open to members yet.** Only admins can list. See
> `MARKETPLACE_SELLER_SPEC.md` for the planned seller programme.

---

## 7. Wardrobe Wags — `/wags`

Monthly digital subscription box, dog and cat only.

| Plan | Monthly | Yearly | Items/month |
|---|---|---|---|
| **Basic** | $5 | $50 (2 months free) | 4 |
| **Plus** | $10 | $100 (2 months free) | 10 |

**Basic:** wearable accessory, seasonal collectible, prefab mini-model, Pawprint.

**Plus adds:** two more accessories, a 5-sticker Purr Pack, a 20-credit boost, a
free video generation, and a free restyle coupon.

**Plus Annual bonus:** a 12-page digital pet calendar, species-matched, delivered
in January or on your anniversary month.

Everything lands as entitlements in the Fur Bin and is immediately usable in
Fido's Styles and Pawprints. Boxes are human-reviewed before release.

*Requires Stripe price IDs to be configured — currently returns 503.*

---

## 8. Everything else

| Feature | Route | What it is |
|---|---|---|
| **Dashboard** | `/` | Home, featured models, quick hits |
| **Fur Bin** | `/fur-bin` | All your creations, models, and entitlements |
| **Albums** | `/albums` | Photo album collections; physical printing available |
| **Store** | `/store` | Buy PupCoins |
| **Community** | `/community` | Shared memories, pet recall news, live pet board |
| **Pet Health** | `/pet-health` | Health profile and logs per pet |
| **Profile** | `/profile` | Account, PupCoin balance, referrals, storage |
| **Animator** | `/animator` | Currently behind an under-construction lock |

---

## 9. PupCoins

Earned or bought. Spent on generation.

- **Daily streak** — claim once a day for +5 and a treat
- **Referrals** — credited when a referred user completes signup
- **Profile bonus** — one-time, for completing your profile
- **Purchase** — Store, or the overflow menu

Failed generations refund automatically. If a rig fails its quality gates, only
the rigging add-on is refunded — you keep the static model you paid for.

---

## 10. Limits

| Limit | Value |
|---|---|
| Models per account | 5 (`MODEL_CAP`) |
| Upload size | 10 MB per photo |
| Description length | 500 characters |
| Rate limits | Per-user quotas on paid generation endpoints |
| Storage | Metered; cold storage purchasable from Profile |
