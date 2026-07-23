# Wardrobe Wags V2 Setup

Wags V2 uses Stripe Checkout subscriptions, a dedicated signed webhook, durable plan versions, and owner-scoped subscriptions. A customer with no subscription sees plan choices and a Subscribe button; absence of a subscription is not an error.

## Required Hostinger variables

```text
WAGS_V2_ENABLED=true
STRIPE_SECRET_KEY=<existing Stripe secret key>
WAGS_STRIPE_WEBHOOK_SECRET=<signing secret for the Wags-only Stripe endpoint>
```

Create a separate Stripe webhook endpoint:

```text
https://pawsome3d.com/api/wags-v2/stripe/webhooks
```

Subscribe it to the subscription and invoice lifecycle events used by Wags. Do not reuse `STRIPE_WEBHOOK_SECRET`; copy the signing secret from this dedicated endpoint into `WAGS_STRIPE_WEBHOOK_SECRET`.

## Plan setup

Wags V2 reads active, published rows from `wags_plan_versions_v2`. Each plan version must contain:

- a stable public `plan_uuid`
- a positive `version_number`
- `basic` or `plus` tier
- `monthly` or `annual_prepaid` cadence
- the matching Stripe recurring Price ID in `provider_price_ref`
- immutable `plan_json` and its SHA-256 `plan_hash`
- `active = true` and a current `published_at`

Run database migrations before enabling the feature. Restart the Hostinger Node application after variables or plans change. Then open **Wardrobe Wags**, verify that plans load, complete a Stripe test checkout, and confirm the returning account shows its membership without a “Subscription not found” error.

