import { type Pool } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { getPrivateSignedUrl } from "../storage.private";
import type { ListingQuerySchema } from "./marketplaceSchemas";
import { z } from "zod";

/**
 * Phase 4 — Public Marketplace & Digital Purchase Checkout
 *
 * This module mirrors server/marketplaceAdmin.ts, but exposes ONLY safe,
 * read-only views for public browsing, and implements the digital checkout
 * flow which creates the awaiting_payment order and Stripe session.
 *
 * Entitlements are ONLY granted by the webhook.
 */

// Helper to attach signed URLs to a set of listings
async function attachPreviews(pool: Pool, listings: any[]) {
  if (!listings.length) return listings;
  const ids = listings.map((l) => l.id);
  const [assetRows] = await pool.query(
    `SELECT listing_id, id, object_key, sort_order 
     FROM marketplace_assets 
     WHERE listing_id IN (?) AND kind = 'preview_image' AND status = 'active'
     ORDER BY listing_id, sort_order, id`,
    [ids]
  ) as any;

  // Group by listing_id and mint signed URLs
  const previewsByListing = new Map<number, any[]>();
  for (const row of assetRows as any[]) {
    const signed = await getPrivateSignedUrl(String(row.object_key));
    const list = previewsByListing.get(row.listing_id) || [];
    list.push({ id: row.id, sort_order: row.sort_order, url: signed.url, expiresAt: signed.expiresAt });
    previewsByListing.set(row.listing_id, list);
  }

  for (const l of listings) {
    l.previews = previewsByListing.get(l.id) || [];
  }
  return listings;
}

export async function publicListings(pool: Pool, query: z.infer<typeof ListingQuerySchema>) {
  const { category, q, page, per_page } = query;
  const conditions = ["status = 'published'"];
  const params: any[] = [];

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (q) {
    conditions.push("(name LIKE ? OR description LIKE ? OR tags_json LIKE ?)");
    const term = `%${q}%`;
    params.push(term, term, term);
  }

  const where = "WHERE " + conditions.join(" AND ");
  const offset = (page - 1) * per_page;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM marketplace_listings ${where}`,
    params
  ) as any;
  const total = countRows[0].total;

  params.push(per_page, offset);
  const [rows] = await pool.query(
    `SELECT id, uuid, slug, name, breed, category, description, tags_json, dimensions_json,
            digital_price_cents, physical_enabled, print_size_min_mm, print_size_max_mm,
            sort_order, updated_at, created_at
     FROM marketplace_listings
     ${where}
     ORDER BY sort_order ASC, created_at DESC
     LIMIT ? OFFSET ?`,
    params
  ) as any;

  const listings = await attachPreviews(pool, rows);
  return { listings, total, page, per_page };
}

export async function publicListing(pool: Pool, uuid: string) {
  const [rows] = await pool.query(
    `SELECT id, uuid, slug, name, breed, category, description, tags_json, dimensions_json,
            digital_price_cents, physical_enabled, print_size_min_mm, print_size_max_mm,
            sort_order, updated_at, created_at
     FROM marketplace_listings
     WHERE uuid = ? AND status = 'published' LIMIT 1`,
    [uuid]
  ) as any;

  if (!rows || rows.length === 0) return null;
  const [listing] = await attachPreviews(pool, [rows[0]]);
  return listing;
}

export async function checkoutDigital(
  pool: Pool,
  userPhone: string,
  listingUuid: string,
  idempotencyKey: string,
  stripe?: any,
  appUrl?: string
) {
  // 1. Resolve listing and active source_glb
  const [lRows] = await pool.query(
    `SELECT id, name, digital_price_cents FROM marketplace_listings WHERE uuid = ? AND status = 'published' LIMIT 1`,
    [listingUuid]
  ) as any;
  if (!lRows || lRows.length === 0) {
    throw new Error("Listing not found or not published.");
  }
  const listing = lRows[0];
  if (listing.digital_price_cents == null) {
    throw new Error("This listing is not available for digital purchase.");
  }

  const [aRows] = await pool.query(
    `SELECT id FROM marketplace_assets WHERE listing_id = ? AND kind = 'source_glb' AND status = 'active' LIMIT 1`,
    [listing.id]
  ) as any;
  if (!aRows || aRows.length === 0) {
    throw new Error("Listing has no active 3D model.");
  }
  const assetId = aRows[0].id;

  // 2. Check entitlement (409 if owned)
  const [eRows] = await pool.query(
    `SELECT id FROM marketplace_entitlements WHERE user_phone = ? AND listing_id = ? AND revoked_at IS NULL LIMIT 1`,
    [userPhone, listing.id]
  ) as any;
  if (eRows && eRows.length > 0) {
    const err: any = new Error("You already own this model.");
    err.status = 409;
    throw err;
  }

  // 3. Create or resume order via Idempotency-Key
  const [existingOrder] = await pool.query(
    `SELECT id, status, stripe_session_id, checkout_url FROM marketplace_digital_orders 
     WHERE user_phone = ? AND idempotency_key = ? LIMIT 1`,
    [userPhone, idempotencyKey]
  ) as any;

  if (existingOrder && existingOrder.length > 0) {
    return { 
      orderId: existingOrder[0].id, 
      status: existingOrder[0].status,
      checkoutUrl: existingOrder[0].checkout_url,
      stripeSessionId: existingOrder[0].stripe_session_id 
    };
  }

  const [insert] = await pool.query(
    `INSERT INTO marketplace_digital_orders (user_phone, listing_id, asset_id, price_cents, idempotency_key)
     VALUES (?, ?, ?, ?, ?)`,
    [userPhone, listing.id, assetId, listing.digital_price_cents, idempotencyKey]
  ) as any;
  const orderId = insert.insertId;

  let checkoutUrl: string | undefined;
  let stripeSessionId: string | undefined;

  if (stripe) {
    const baseUrl = appUrl || process.env.APP_URL || "http://localhost:5173";
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: String(listing.name || "Digital 3D Model"),
            description: "Digital 3D model download — instant access after payment.",
          },
          unit_amount: listing.digital_price_cents,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${baseUrl}/fur-bin?digital_success=true&order_id=${orderId}`,
      cancel_url: `${baseUrl}/marketplace`,
      metadata: {
        type: "marketplace_digital",
        digitalOrderId: String(orderId),
        userPhone,
        listingId: String(listing.id),
      },
    });

    stripeSessionId = session.id;
    checkoutUrl = session.url;

    await pool.query(
      `UPDATE marketplace_digital_orders SET stripe_session_id = ?, checkout_url = ? WHERE id = ?`,
      [session.id, session.url, orderId]
    );
  }

  return {
    orderId,
    priceCents: listing.digital_price_cents,
    listingId: listing.id,
    assetId,
    title: String(listing.name || "Digital 3D Model"),
    checkoutUrl,
    stripeSessionId,
  };
}

export async function getOrderStatus(pool: Pool, userPhone: string, orderId: number) {
  const [rows] = await pool.query(
    `SELECT status FROM marketplace_digital_orders WHERE id = ? AND user_phone = ? LIMIT 1`,
    [orderId, userPhone]
  ) as any;
  if (!rows || rows.length === 0) throw new Error("Order not found.");
  return { status: rows[0].status };
}

export async function getUserEntitlements(pool: Pool, userPhone: string) {
  const [rows] = await pool.query(
    `SELECT e.id as entitlement_id, e.asset_id, e.created_at,
            l.uuid as listing_uuid, l.name, l.slug, l.category
     FROM marketplace_entitlements e
     JOIN marketplace_listings l ON e.listing_id = l.id
     WHERE e.user_phone = ? AND e.revoked_at IS NULL
     ORDER BY e.created_at DESC`,
    [userPhone]
  ) as any;
  
  // Attach one preview for each entitlement for FurBin display
  if (rows && rows.length > 0) {
    const listingIds = rows.map((r: any) => r.listing_id);
    // Attach preview by looking up the listing ...
    // Or just do a join in another query.
    // Actually we can reuse attachPreviews if we shape the array like listings!
    // But rows has `listing_uuid`. Let's just run a second query.
    const [assetRows] = await pool.query(
      `SELECT listing_id, object_key FROM marketplace_assets
       WHERE listing_id IN (SELECT listing_id FROM marketplace_entitlements WHERE user_phone = ? AND revoked_at IS NULL)
       AND kind = 'preview_image' AND status = 'active' AND sort_order = 0`,
      [userPhone]
    ) as any;
    const previewMap = new Map();
    for (const a of assetRows as any[]) {
      const signed = await getPrivateSignedUrl(String(a.object_key));
      previewMap.set(a.listing_id, signed.url);
    }
    // Re-run query to include listing_id for map lookup
    const [rows2] = await pool.query(
      `SELECT e.id as entitlement_id, e.asset_id, e.created_at, e.listing_id,
              l.uuid as listing_uuid, l.name, l.slug, l.category
       FROM marketplace_entitlements e
       JOIN marketplace_listings l ON e.listing_id = l.id
       WHERE e.user_phone = ? AND e.revoked_at IS NULL
       ORDER BY e.created_at DESC`,
      [userPhone]
    ) as any;
    for (const r of rows2 as any[]) {
      r.preview_url = previewMap.get(r.listing_id) || null;
      delete r.listing_id;
    }
    return rows2;
  }
  return rows;
}

export async function digitalDownload(pool: Pool, userPhone: string, listingUuid: string) {
  const [eRows] = await pool.query(
    `SELECT e.asset_id 
     FROM marketplace_entitlements e
     JOIN marketplace_listings l ON e.listing_id = l.id
     WHERE e.user_phone = ? AND l.uuid = ? AND e.revoked_at IS NULL LIMIT 1`,
    [userPhone, listingUuid]
  ) as any;
  if (!eRows || eRows.length === 0) {
    const err: any = new Error("You do not own this model, or access was revoked.");
    err.status = 403;
    throw err;
  }
  const assetId = eRows[0].asset_id;
  const [aRows] = await pool.query(
    `SELECT object_key, mime_type, size_bytes FROM marketplace_assets WHERE id = ? LIMIT 1`,
    [assetId]
  ) as any;
  if (!aRows || aRows.length === 0) throw new Error("Asset missing.");
  
  const signed = await getPrivateSignedUrl(String(aRows[0].object_key));
  return {
    url: signed.url,
    expiresAt: signed.expiresAt,
    mime_type: aRows[0].mime_type,
    size_bytes: aRows[0].size_bytes
  };
}
