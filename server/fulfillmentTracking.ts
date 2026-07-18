export interface ShipmentTracking {
  carrier: string | null;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max = 160): string | null {
  if (value == null) return null;
  const output = String(value).trim();
  return output ? output.slice(0, max) : null;
}

function safeUrl(value: unknown): string | null {
  const candidate = text(value, 2048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function dateText(value: unknown): string | null {
  if (value == null || value === "") return null;
  const asNumber = Number(value);
  const date = Number.isFinite(asNumber) && asNumber > 0
    ? new Date(asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shipment(value: unknown): ShipmentTracking | null {
  const row = record(value);
  if (!row) return null;
  const trackingNumber = text(row.tracking_number ?? row.trackingNumber ?? row.tracking_code ?? row.trackingCode);
  const trackingUrl = safeUrl(row.tracking_url ?? row.trackingUrl ?? row.trackingURL);
  if (!trackingNumber && !trackingUrl) return null;
  return {
    carrier: text(row.carrier ?? row.shipping_carrier),
    service: text(row.service ?? row.shipping_service),
    trackingNumber,
    trackingUrl,
    shippedAt: dateText(row.shipped_at ?? row.shippedAt ?? row.ship_date ?? row.shipDate),
  };
}

function collectCandidates(value: unknown, depth = 0): unknown[] {
  if (depth > 4 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectCandidates(item, depth + 1));
  const row = record(value);
  if (!row) return [];
  const candidates: unknown[] = [row];
  for (const [key, child] of Object.entries(row)) {
    if (/shipment|tracking|fulfillment|package|order|data/i.test(key)) {
      candidates.push(...collectCandidates(child, depth + 1));
    }
  }
  return candidates;
}

export function parseProviderPayload(value: unknown): unknown {
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Extract only customer-safe shipment fields from a provider response. */
export function extractShipmentTracking(value: unknown): ShipmentTracking[] {
  const parsed = parseProviderPayload(value);
  const unique = new Map<string, ShipmentTracking>();
  for (const candidate of collectCandidates(parsed)) {
    const item = shipment(candidate);
    if (!item) continue;
    const key = item.trackingUrl || item.trackingNumber || "";
    if (key && !unique.has(key)) unique.set(key, item);
    if (unique.size >= 5) break;
  }
  return [...unique.values()];
}
