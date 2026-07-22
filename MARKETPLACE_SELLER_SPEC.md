# Marketplace Seller Programme — Architectural Spec

**Status:** Design. Not scheduled. Blocked on `SEO_ACTION_PLAN.md` phases 1–3 and 7.
**Scope:** Opening the marketplace so members can list models and accessories
they own, with a licence model and a **7% platform commission**.
**Companions:** `MARKETPLACE_AND_STYLES_SPEC.md` (current admin-only marketplace),
`SEO_ACTION_PLAN.md` (listing routes), `IMPLEMENTATION_SPEC.md`.

---

## 0. What already exists

Not a greenfield build. The current marketplace is admin-only but structurally
complete, and most of it generalises:

| Component | State | Reusable? |
|---|---|---|
| `marketplace_listings` | Full schema, `created_by` already per-user | Yes — needs seller columns |
| `marketplace_assets` | GLB + previews, active/retired lifecycle | Yes, unchanged |
| `marketplace_entitlements` | Per-user grants, revocable | Yes, unchanged |
| `marketplace_digital_orders` | One-time Stripe checkout, idempotent | Yes — needs commission split |
| Private/public bucket split | `storage.private.ts`, presigned reads | Yes, unchanged |
| Admin catalog manager | Full CRUD + presigned upload | Becomes the moderation queue |
| Stripe webhook grant | `checkout.session.completed` → entitlement | Yes — extend for payouts |

**The genuinely new work is:** seller identity and payouts, provenance
verification, the licence model, commission accounting, and moderation.

---

## 1. The problem that makes this different from a normal marketplace

Most digital marketplaces only need to answer *"does the seller own this file?"*

This one has a harder question, because of how the assets are made.

**Every model on this platform was generated from a photograph by a third-party
AI service (Tripo), on our infrastructure, usually depicting a real animal owned
by a real person.** That produces four overlapping claims on a single GLB:

1. **The photographer** — whoever took the source photo holds copyright in it
2. **The pet owner** — who may not be the photographer, and whose animal is the
   subject
3. **The platform** — which ran the generation and holds the pipeline
4. **The AI provider** — whose terms govern commercial use of outputs

A seller uploading "their" model may satisfy none of these. Someone can upload a
photo of a neighbour's dog, or a stock image, or a breeder's copyrighted
photography, and receive a sellable model minutes later.

**Design consequence:** provenance is not a checkbox at listing time. It has to be
established at *creation* time and carried forward, because after the fact there
is no way to tell a self-photographed pet from a scraped one.

---

## 2. Provenance model

### 2.1 Only platform-generated assets may be listed — at launch

Sellers list models **created on this platform, by their own account, from their
own uploads**. No external GLB uploads in v1.

This is restrictive and deliberate. It means:
- Every listable asset already has a `creations` row with a `user_phone`
- The source image is already stored and attributable
- The Tripo task ID is already recorded
- We can prove the seller ran the generation

Allowing arbitrary GLB uploads means accepting stolen assets from Sketchfab,
CGTrader, and Turbosquid on day one, with no practical detection. Revisit only
with a licence-verification partner.

### 2.2 Provenance record

Add to `marketplace_listings`:

```sql
seller_phone            VARCHAR(32)  NULL,     -- NULL = platform/admin listing
source_creation_id      INT          NULL,     -- FK creations.id
provenance_status       ENUM('platform','verified_own','disputed','revoked')
                                     NOT NULL DEFAULT 'platform',
rights_attestation_at   TIMESTAMP    NULL,
rights_attestation_ip   VARCHAR[45]  NULL,
```

A listing may only reach `published` when:
- `source_creation_id` belongs to `seller_phone`, **and**
- `rights_attestation_at` is set, **and**
- moderation has passed (§6)

### 2.3 The attestation

At listing time the seller affirms, with the text stored and versioned:

> I created this model on Pawsome3D from a photograph I took, or that I have
> permission to use. The animal shown is mine, or I have the owner's permission
> to sell a model of it. This is not based on someone else's photograph, a
> copyrighted image, or a model from another platform.

Record the **exact text version**, timestamp, and IP. An attestation you can't
reproduce later is worthless in a takedown dispute.

### 2.4 Human likeness — hard block

The create flow now supports a **Person** subject type. Models of identifiable
people **may not be listed**, regardless of attestation, and regardless of whether
the seller is the person depicted.

Reason: right of publicity is jurisdictional, survives death by 50–100 years in
many US states, and a self-portrait creates no defence for the *buyer's* downstream
use — which is what a licence has to cover. Enforce by blocking listings whose
`source_creation.species = 'human'` at the API layer, not just the UI.

---

## 3. Licence model

### 3.1 Two licences, chosen by the seller

| | **Personal** | **Commercial** |
|---|---|---|
| Print for yourself | ✅ | ✅ |
| Use in personal projects | ✅ | ✅ |
| Sell physical prints of it | ❌ | ✅ |
| Use in a commercial product | ❌ | ✅ |
| Use in advertising | ❌ | ✅ |
| Redistribute the GLB | ❌ | ❌ |
| Resell on this or another marketplace | ❌ | ❌ |
| Train an AI model on it | ❌ | ❌ |
| Claim authorship | ❌ | ❌ |

Both are **non-exclusive, non-transferable, perpetual, revocable on breach**.
Neither transfers copyright.

Redistribution is prohibited in both because the asset is delivered as a raw GLB.
Once a buyer has the file, the licence is the only control — so it must be
explicit that possession is not permission.

### 3.2 Schema

```sql
-- On marketplace_listings
licence_type          ENUM('personal','commercial') NOT NULL DEFAULT 'personal',
licence_version       VARCHAR(32)  NOT NULL,

-- On marketplace_entitlements
licence_type          ENUM('personal','commercial') NOT NULL,
licence_version       VARCHAR(32)  NOT NULL,
licence_text_sha256   CHAR(64)     NOT NULL,
```

**Store the hash of the licence text granted at purchase.** Licence terms will be
revised; a buyer is bound by the version in force when they bought, and you must
be able to prove which that was. A version string alone doesn't survive an edit to
the underlying text.

### 3.3 Delivery

Every digital download includes a generated `LICENCE.txt` alongside the GLB:
buyer identity, listing, licence type and version, purchase date, order ID, and
full terms. Zip them together — a GLB alone travels with no evidence of terms.

### 3.4 Upstream constraint — RESOLVED 2026-07-21: launch Personal-only

**Checked against Tripo's Terms of User Agreement (Holymolly Ltd), last updated
2025-07-11, read in full at <https://www.tripo3d.ai/terms>.**

**Verdict: do not enable the Commercial licence. Launch Personal-only.**

The sublicensing question splits into three, and only the first one comes back
clean.

**(a) Can a paid Tripo user commercially exploit and sublicense Outputs?
Yes — §5.2.2.** Paid Users are granted "all rights (including but not limited
to: use, copy, reproduce, modify, adapt, publish, translate, create derivative
works from, distribute, promote, **transfer, authorize and license**, optimize,
**derive revenue or other remuneration from**, and communicate to the public,
perform and display)" over Outputs. On its face that covers selling a GLB to a
buyer and granting them onward rights.

Note the tier cliff: **§5.2.1 gives Free Users nothing.** For free-tier
accounts "Tripo retains all rights" in the Outputs. Anything generated on a
free key is unsellable under any licence. Confirm every production key is on a
paid plan before a single listing goes live.

**(b) Can we expose Tripo generation to our end users at all? Not without
written permission — §3.2.** The restrictions list bars users from:

> "make the Generative 3D Foundation Model Service available to any third
> party, **including end users**, without the prior written authorization and
> consent of Holymolly."

This is the blocker, and it is broader than the marketplace — it describes what
Pawsome3D already does today on the Create flow, not just what the marketplace
would add. **Action: write to support@tripo3d.ai and obtain that authorization
in writing regardless of the licence decision.** Until it exists, the entire
consumer-facing generation pipeline sits outside the agreement.

**(c) Does a 3D-model marketplace "directly compete"? Arguable — §3.2.** The
same section bars using Outputs "to create models or services that directly
compete with Holymolly and its models, products and services." Tripo sells 3D
model generation. A marketplace of AI-generated 3D models is close enough that
a reasonable counterparty could assert it, and we would be arguing the point
under Hong Kong law at HKIAC arbitration (§11) — an expensive venue in which to
discover we were wrong.

**Why Personal-only even though (a) is permissive.** Three compounding reasons:

1. (b) is unresolved and is a precondition, not a detail.
2. §1 lets Holymolly change these terms **unilaterally at sole discretion**,
   with continued use constituting acceptance. A commercial licence we sell to
   a buyer is perpetual; our right to grant it is revocable by a third party
   with no notice period. That asymmetry is unacceptable — we would be issuing
   irrevocable grants backed by a revocable permission.
3. §9 indemnification is broad and uncapped in our direction, while §4 caps
   Holymolly's liability to us at the greater of trailing-12-month spend or
   $500. If a buyer's commercial use triggers a claim, we absorb it.

### 3.5 Phase-out plan for Tripo dependency

Personal-only is a holding position, not a destination — it caps marketplace
revenue per listing and blocks the seller segment most likely to pay. The exit
is to remove the upstream constraint rather than negotiate around it.

**Stage 1 — now, before marketplace launch.**
Ship Personal-only. Gate `licence_type = 'commercial'` behind a server-side
feature flag that is off, so the schema and checkout flow are exercised but the
option is unreachable. Send the §3.2 authorization request to Tripo.

**Stage 2 — provenance tracking (do this before Stage 3, not after).**
Record generator provenance per asset so a future licence upgrade can be
applied selectively. `marketplace_assets` already carries `source_license`;
extend it with `generator` (`tripo` | `hermes` | `imported`) and
`generator_version`. Without this, a later commercial-licence launch cannot
tell which back-catalogue assets are eligible, and the whole catalogue stays
stuck at the most restrictive licence.

**Stage 3 — first-party generation path.**
The `blender-worker` and `hermes-looks-worker` services already produce
riggable meshes. Route new marketplace-destined generation to a first-party or
permissively-licensed pipeline. Assets marked `generator = 'hermes'` carry no
upstream sublicensing constraint and can offer Commercial on day one — which
gives sellers a concrete reason to prefer the first-party path and makes the
migration self-propelling rather than a forced cutover.

**Stage 4 — flip Commercial on, per-asset.**
Enable the commercial licence only for listings whose every asset has a
clean-provenance generator. Tripo-generated back catalogue stays Personal-only
permanently — do not attempt a retroactive upgrade, since the terms in force at
generation time are what govern.

**Trigger to revisit sooner:** written authorization from Holymolly that
explicitly permits (i) making the service available to our end users and
(ii) sublicensing Outputs to buyers for commercial use. If that arrives,
Stage 4 can run against Tripo assets too — but the §1 unilateral-amendment risk
in point 2 above still argues for finishing Stage 3 regardless.

---

## 4. Commission and payouts

### 4.1 The 7% split

Platform takes **7%** of gross sale price. Seller receives 93% less payment
processing.

```
Sale price                        $20.00
Platform commission (7%)          -$1.40
Stripe fee (2.9% + $0.30)         -$0.88
─────────────────────────────────────────
Seller net                        $17.72
```

**DECIDED 2026-07-21: (A) — the seller absorbs Stripe's fee.** Platform nets a
clean 7% of gross; the seller receives 93% less payment processing, exactly as
the worked example above shows.

Rejected alternative — **(B) platform absorbs**, seller always nets exactly 93%.
Cleaner to explain, but the platform's margin goes negative on low-price
listings: on a $3.00 sale, 7% is $0.21 while Stripe takes $0.39, so the
platform loses $0.18 on every transaction and loses more the more it sells.

**Enforce a $3.00 minimum listing price** so the fixed $0.30 component never
dominates. At the floor the seller nets $2.40 of $3.00 (80%); by $20.00 that
rises to $17.72 (89%). Below $3.00 the split stops being defensible to sellers.

Implementation requirements for (A):

- Stripe Connect `application_fee_amount` = **7% of gross, rounded to the
  nearest cent**. With `on_behalf_of` set to the seller's connected account,
  Stripe's processing fee is deducted from the seller's balance, which is
  precisely model (A) — no manual fee arithmetic on our side.
- Reject listings priced under $3.00 at the schema layer, not just in the UI,
  so the API cannot be used to create a loss-making listing.
- State the split in the seller terms **as a worked example at two price
  points**, not as a formula. "You keep 93% minus payment processing" reads as
  93% to most sellers; a $3.00 and a $20.00 table does not.
- Surface projected net on the listing form as the seller types a price. Fee
  surprises after the first payout are the most common seller-trust failure in
  a marketplace, and they are entirely preventable here.

### 4.2 Stripe Connect — required

Direct payouts need **Stripe Connect Express**. This is not optional: paying
sellers from your own balance makes you a money transmitter in many
jurisdictions. Connect makes Stripe the payment facilitator.

```
seller_accounts
  user_phone              VARCHAR(32) PK
  stripe_account_id       VARCHAR(128) NOT NULL
  onboarding_status       ENUM('pending','restricted','active','rejected')
  payouts_enabled         TINYINT(1) NOT NULL DEFAULT 0
  charges_enabled         TINYINT(1) NOT NULL DEFAULT 0
  country                 CHAR(2)
  created_at / updated_at
```

Onboarding: `POST /api/seller/onboard` → Connect account → `accountLinks.create`
→ redirect. Stripe handles identity, tax forms, and bank details. Poll
`account.updated` webhooks for status.

**No listing may publish until `payouts_enabled = 1`.** Otherwise you accrue
liabilities to someone who cannot be paid.

### 4.3 Split at charge time

Use `payment_intent_data.application_fee_amount` with `transfer_data.destination`
on the existing Checkout session:

```ts
const commissionCents = Math.round(priceCents * 0.07);

const session = await stripe.checkout.sessions.create({
  mode: "payment",
  payment_method_types: ["card"],
  line_items: [...],
  payment_intent_data: {
    application_fee_amount: commissionCents,
    transfer_data: { destination: sellerStripeAccountId },
  },
  metadata: {
    type: "marketplace_digital",
    digitalOrderId: String(orderId),
    userPhone: buyerPhone,
    listingId: String(listingId),
    sellerPhone,
    commissionCents: String(commissionCents),
  },
});
```

Splitting at charge time rather than settling later means you never hold seller
funds, which is the point.

### 4.4 Ledger

```
marketplace_payouts
  id, digital_order_id, seller_phone, gross_cents,
  commission_cents, stripe_fee_cents, seller_net_cents,
  stripe_transfer_id, status ENUM('pending','paid','reversed','held'),
  created_at
```

Written by the webhook, never by the checkout route. Reconcile monthly against
Stripe's balance transactions — a ledger you never reconcile is a guess.

### 4.5 Refunds and clawback

A refund after payout means recovering money already transferred. Options:

- **Rolling reserve** — hold 10% for 30 days
- **Negative balance** — Connect supports it; recovers from future sales
- **Refund window** — no refunds on digital goods after download, disclosed
  prominently at checkout

**Recommendation:** 14-day refund window, void on download, plus negative-balance
recovery for chargebacks (which you cannot prevent regardless of policy).

---

## 5. Seller flow

```
1. Enable selling      → Profile → "Sell your models" → Connect onboarding
2. Choose an asset     → only models created by this account, human-subject blocked
3. Create listing      → title, description, category, tags, price, licence type
4. Attest rights       → §2.3 text, stored with version + timestamp + IP
5. Submit for review   → status = 'pending_review'
6. Moderation          → §6
7. Published           → indexable listing page (SEO plan §7)
8. Sale                → Stripe splits at charge; entitlement granted by webhook
9. Payout              → Stripe transfers to Connect account on its schedule
```

### API surface

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/seller/onboard` | Start Connect onboarding |
| GET | `/api/seller/status` | Onboarding + payout state |
| GET | `/api/seller/eligible-assets` | Own creations that may be listed |
| POST | `/api/seller/listings` | Create (always `draft`) |
| PATCH | `/api/seller/listings/:id` | Edit while draft/rejected |
| POST | `/api/seller/listings/:id/submit` | → `pending_review` |
| DELETE | `/api/seller/listings/:id` | Delist (never hard-delete — §7) |
| GET | `/api/seller/sales` | Sales + payout ledger |

Every route verifies `seller_phone === req.user.phone`. Never trust a listing ID
alone.

---

## 6. Moderation

**Every first listing from a seller is human-reviewed.** After three clean
listings, auto-approve with post-publication spot checks.

Automated pre-checks (block before a human sees it):

| Check | Action |
|---|---|
| `source_creation.user_phone !== seller_phone` | Reject — not their creation |
| `source_creation.species === 'human'` | Reject — §2.4 |
| No active `source_glb` asset | Reject |
| No preview image | Reject |
| Price below minimum | Reject |
| Duplicate `source_creation_id` already listed | Reject |
| Perceptual hash matches an existing listing | Flag for review |

Human review covers: is the preview actually the model, is the description
accurate, is it obviously someone else's IP, is it a duplicate under a new name.

Reuse the admin catalog manager UI — it already lists, previews, and edits.

---

## 7. Takedown and dispute handling

You will receive DMCA notices. Build for it now.

1. **Designated agent** — register with the US Copyright Office. Without this
   there is no safe-harbour protection at all.
2. **Notice endpoint** — a real form, not just an email address.
3. **On valid notice:** set `provenance_status = 'disputed'`, unpublish, revoke
   nothing yet, notify the seller.
4. **Counter-notice window** — 10–14 business days.
5. **On no counter-notice:** `provenance_status = 'revoked'`, listing stays
   unpublished permanently.
6. **Existing buyers** — decide policy now: revoke and refund, or honour
   existing licences. **Recommendation:** honour existing licences, refund only
   on request. Retroactively revoking a paid licence from an innocent buyer
   creates a second dispute.
7. **Never hard-delete a listing.** You need the record for the dispute and for
   the SEO decision about what its URL returns (410 vs redirect).

Repeat infringers: three upheld claims → selling privileges revoked. This
threshold is a safe-harbour requirement, not a courtesy.

---

## 8. Tax

- **Stripe Connect handles 1099-K** for US sellers at the reporting threshold
- **Sales tax on digital goods** varies by state and is the platform's
  responsibility as marketplace facilitator in most of them — **Stripe Tax is
  strongly recommended** rather than hand-rolling nexus rules
- **VAT/OSS** if selling into the EU. Consider geo-restricting v1 to US/CA and
  expanding deliberately.

---

## 9. Build phases

| Phase | Scope | Gate |
|---|---|---|
| **S1** | Connect onboarding, `seller_accounts`, status UI | Test-mode payout end to end |
| **S2** | Seller listing CRUD, eligible-asset picker, attestation | Draft listing from own creation |
| **S3** | Moderation queue, automated pre-checks | Rejection round-trip works |
| **S4** | Commission split, `marketplace_payouts`, sales dashboard | Live sale splits 93/7 correctly |
| **S5** | Licence generation, `LICENCE.txt` in download zip | Hash recorded and reproducible |
| **S6** | DMCA endpoint, dispute states, repeat-infringer tracking | Full takedown rehearsal |
| **S7** | Indexable listing pages, `Product` JSON-LD | SEO plan §7 satisfied |

**S1–S3 before any money moves. S6 before public launch, not after.**

---

## 10. Decisions needed before S1

| # | Decision | Blocks |
|---|---|---|
| 1 | Do Tripo's terms permit sublicensing commercial rights to buyers? | §3.4 — may force Personal-only launch |
| 2 | Seller or platform absorbs Stripe fees? | §4.1 |
| 3 | Minimum listing price? (recommend $3.00) | §4.1 |
| 4 | Refund window and download-voids-refund? | §4.5 |
| 5 | Geographic scope for v1? | §8 |
| 6 | Are member listings indexable, or `noindex` until proven? | SEO §7 |
| 7 | Existing buyers on takedown — honour or revoke? | §7.6 |

Decisions 1 and 2 are the two that change the schema. Settle those first.
