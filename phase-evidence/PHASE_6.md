# Phase 6 Evidence: Stationery and Physical Fulfillment

Status: Domain code complete; physical provider integration blocked
Feature flag: `STATIONERY_V2_ENABLED=false`
Migration: 27

Implemented: strict versioned templates, physical dimensions/DPI/bleed/safe-area/font-rights validation, immutable render and print manifests, render outbox, paid-payment evidence, HMAC render/provider callbacks, owner/hash-bound private file URLs, provider replay protection, and reconciliation.

Automated evidence: 30/30 focused tests pass; schema 27 applies in the full MySQL migration run; TypeScript, full 1,031-test executed suite, and production build pass.

Blocker: the v2 order contract has no approved shipping snapshot and therefore installs no Printful/Slant submission adapter. Physical submission correctly returns unavailable. Add the shipping contract, Stripe payment writer, provider sandboxes, refund evidence, and physical sample approval before enabling.

Decision: merge/deploy default-off; Phase 6 is not production-approved.
