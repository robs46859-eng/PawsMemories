# Phase 7 Evidence: Wags Subscription Packs

Status: Server code complete; external/UI acceptance pending
Feature flag: `WAGS_V2_ENABLED=false`
Migration: 28

Implemented: raw Stripe webhook verification, idempotent checkout, versioned plans/packs, lifecycle ordering, payment coverage, monthly periods, owned-item substitution, exactly-once asset/credit grants, annual prepaid incentive, cancellation boundaries, and reconciliation. Production routes mount before global JSON parsing only when explicitly enabled.

Automated evidence: 37/37 focused tests pass, including clean MySQL migration, concurrent grants, replay/out-of-order events, failed payment, cancellation, Stripe adapter, and ledger rollback. TypeScript, full suite, and production build pass.

Remaining: approve customer checkout/inbox UI; create the separate Stripe endpoint and `WAGS_STRIPE_WEBHOOK_SECRET`; run Stripe sandbox renewal, failed-payment, proration/cancellation, annual incentive, and entitlement audits.

Decision: merge/deploy default-off; do not enable until sandbox and human UI gates pass.
