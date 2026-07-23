# Printful Pawprints Setup

Pawprints uses a server-owned Printful catalog connection. Administrators map a Pawsome3D marketplace listing to one Printful product variant and its authoritative print area. Customers never see or submit the Printful token.

## 1. Create the Printful store and token

1. Create a Printful store for Pawsome3D.
2. In Printful, create a private API token with catalog, orders, files, and store access.
3. Prefer a store-scoped token. If the token is account-scoped, also copy the Printful store ID.
4. Add the token only to Hostinger's server environment. Never paste it into the browser or commit it.

Hostinger variables:

```text
PRINTFUL_API_KEY=<private Printful token>
PRINTFUL_API_BASE_URL=https://api.printful.com
PRINTFUL_STORE_ID=<required for an account-level token; optional for a store-scoped token>
PRINTFUL_WEBHOOK_SECRET=<secret used to validate Printful callbacks>
```

Restart the Hostinger Node application after changing variables.

## 2. Create and publish a product mapping

1. Sign in to Pawsome3D as an administrator.
2. Open the top-right menu and choose **Printful product sync**.
3. Select **Check connection**, then **Sync catalog**.
4. Enter the existing Pawsome3D marketplace listing ID that customers should buy.
5. Choose the Printful product, physical variant, print placement, photo shape, and retail price.
6. Confirm the displayed pixel dimensions and DPI, then choose **Publish product**.
7. Open Pawprints as a customer and run one test customization through checkout.

The Printful **variant ID** identifies the physical item/size/color. It is not a template ID. The product sync screen reads the printable dimensions from Printful so templates cannot silently use an incompatible canvas.

## 3. Production verification

- Use a Printful test/draft order before accepting live orders.
- Confirm the customized print file appears on the correct placement.
- Confirm Stripe payment creates exactly one internal order and one Printful draft.
- Confirm the Printful webhook advances fulfillment status.
- Keep the minimum-margin guard enabled; do not price below provider cost plus the configured margin.

