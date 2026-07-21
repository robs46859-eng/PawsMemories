-- 013_marketplace_checkout_url.sql
-- =============================================================================
-- Adds the column marketplacePublic.checkoutDigital() has always selected but
-- 011_marketplace.sql never created.
--
-- WHY THIS EXISTS
-- ---------------
-- checkoutDigital() resumes an in-flight purchase by looking up the order via
-- its Idempotency-Key:
--
--   SELECT id, status, stripe_session_id, checkout_url
--     FROM marketplace_digital_orders WHERE user_phone = ? AND idempotency_key = ?
--
-- `checkout_url` was never in the table, so that query fails with
-- ER_BAD_FIELD_ERROR on EVERY call — the route threw before it could reach the
-- (also missing) Stripe session creation. Verified against production:
-- marketplace_digital_orders has 12 columns and checkout_url is not among them.
--
-- The column stores Stripe's hosted-checkout URL so a user who closes the tab
-- and retries with the same Idempotency-Key is returned to the SAME session
-- rather than being charged twice. Stripe Checkout sessions expire after 24h;
-- an expired URL simply 404s at Stripe, which the client surfaces as "start
-- again" — safer than minting a second session against a live order.
-- =============================================================================

ALTER TABLE marketplace_digital_orders
  ADD COLUMN checkout_url VARCHAR(600) NULL AFTER stripe_session_id;
