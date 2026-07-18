# Pawsome3D Print Fulfillment

Last reviewed: 2026-07-18

## Production decision

Pawsome3D uses two purpose-specific providers:

- **Slant 3D** is the only provider for physical 3D models. It is a managed US FDM farm with PLA/PETG, file handling, quoting, customers, orders, QC, fulfillment, tracking, and webhooks. A managed farm gives standard figurines more predictable production than a marketplace of unrelated printers.
- **Printful** is the only provider for physical Pawprints stationery. Its product templates, variant IDs, 300-DPI print files, draft-order lifecycle, shipping calculation, confirmation, and fulfillment tracking match personalized flat artwork.

Treatstock is not used or exposed by the application.

## 3D model flow

1. The customer creates and approves a model.
2. The immutable GLB is stored in Backblaze and appears in FurBin.
3. The customer opens the model, selects a physical height in millimeters, and supplies a shipping address.
4. The Blender worker imports a derivative of the GLB, applies uniform scale, triangulates, checks bounds/topology, and exports an STL. The source GLB is never overwritten.
5. The print-ready STL, physical dimensions, target height, and topology evidence are stored as a versioned derivative/order record.
6. Pawsome3D uploads the STL URL to Slant 3D and creates a draft order using the configured PLA/PETG filament.
7. The Slant draft returns production and delivery costs. The server applies `FULFILLMENT_MARKUP_PERCENT` and `FULFILLMENT_MIN_MARGIN_CENTS`; the browser cannot set price or provider IDs.
8. Stripe Checkout collects the customer's payment.
9. Only a verified paid Stripe webhook submits the Slant draft to production.
10. A recovery sweep safely retries paid-but-unsubmitted orders and refreshes active order statuses. FurBin shows the order, price, provider reference, and current status.
11. `/api/fulfillment/readiness` keeps the customer checkout disabled until Slant, Stripe, storage, and the Blender print worker are all available.

### Physical accuracy boundary

- One Three.js unit remains one meter in the application.
- The customer's selected target height is authoritative only for the print derivative.
- A single photograph is not enough to claim real-world dimensional accuracy. The UI offers a chosen figurine size, not a claim that the generated pet is anatomically measured to life.
- The source asset is immutable. The scaled STL, dimensions, topology report, and provider order are derivatives with their own provenance.

## Pawprints flow

1. The customer chooses an occasion, starting template, and one of twelve deterministic collage variations.
2. Custom photos are downscaled sequentially/through a worker to protect mobile memory.
3. Exact customer text and photos are rendered locally; no LLM rewrites the message.
4. The selected layout exports a 2400 × 3000 master and is stored in Backblaze/FurBin.
5. The customer chooses a server-configured Printful format and supplies shipping details.
6. The server generates a separate 300-DPI PNG sized to that product without mutating the saved Pawprint.
7. Printful creates a draft and returns actual product, shipping, and tax costs.
8. The server applies the configured retail price floor and fulfillment margin, then opens Stripe Checkout.
9. Only a verified paid Stripe webhook confirms the Printful draft for production.
10. A recovery sweep retries paid-but-unconfirmed orders and refreshes fulfillment status. FurBin shows the order and print file.
11. The Pawprints Studio keeps physical ordering disabled until Printful, Stripe, storage, and at least one server-owned product mapping are available.

## Required configuration

### Shared

- `APP_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `FULFILLMENT_MARKUP_PERCENT`
- `FULFILLMENT_MIN_MARGIN_CENTS`
- Backblaze `MEDIA_BUCKET_*`

### Slant 3D

- `SLANT3D_API_KEY`
- `SLANT3D_PLATFORM_ID`
- `SLANT3D_DEFAULT_FILAMENT_ID`
- Optional `SLANT3D_API_BASE_URL=https://slant3dapi.com/v2/api`
- Existing `BLENDER_WORKER_URL` and `WORKER_SHARED_SECRET`

### Printful

- `PRINTFUL_API_KEY`
- `PRINTFUL_STORE_ID` when using an account-level token
- `PAWPRINT_PRINT_PRODUCTS_JSON`
- Optional legacy fallback: `PRINTFUL_PAWPRINT_VARIANT_ID`, `PRINTFUL_PAWPRINT_TEMPLATE_ID`

`PAWPRINT_PRINT_PRODUCTS_JSON` must be a one-line JSON array. Example:

```json
[
  {
    "code": "poster-8x10",
    "label": "8 × 10 Art Print",
    "description": "Museum-quality matte poster",
    "variantId": 123,
    "templateId": 456,
    "widthIn": 8,
    "heightIn": 10,
    "priceCents": 2499
  }
]
```

Variant and template IDs are resolved only on the server. Never accept raw provider IDs or prices from the browser.

## Commercial options reviewed

| Provider | Best fit | Decision |
|---|---|---|
| Slant 3D | Managed PLA/PETG farm, API orders, QC, fulfillment, tracking | Selected for standard 3D figurines |
| Printful | Posters, cards, canvases, product templates, fulfillment | Selected for Pawprints |
| Treatstock | Marketplace quotes across independent vendors/materials | Rejected for the customer flow because finish consistency varies |
| Gelato | Global stationery/POD, strong order API and print hubs | Valid Printful fallback, not active to avoid split order systems |
| Prodigi | Fine-art and photo products | Valid premium-art fallback; not active while Printful is the single stationery provider |
| Printify | Broad POD catalog and provider marketplace | Rejected for this flow because provider variability adds another quality-control layer |
| Quote3D | Printability analysis and quoting, including FDM/SLA/SLS | Useful analysis service, but not a direct fulfillment replacement |

Primary references:

- Slant 3D API: https://www.slant3dapi.com/documentation
- Slant 3D capabilities/materials: https://www.slant3d.com/
- Printful Orders API: https://developers.printful.com/docs/
- Gelato Orders API: https://dashboard.gelato.com/docs/orders/order_details/
- Printify API: https://developers.printify.com/
- Quote3D API: https://quote3d.com/en/docs

## Deployment gates

Before enabling customer buttons:

1. Deploy the Hostinger application and the Render Blender worker version that includes `/prepare-print`.
2. Add all provider and Stripe variables.
3. Register `/api/stripe-webhook` in Stripe and verify the signing secret.
4. Keep Slant and Printful test/draft modes until sample orders have been physically inspected.
5. Order at least one Slant figurine at each offered height and one Printful sample for each product code.
6. Validate margins with real shipping/tax responses before advertising fixed retail prices.
