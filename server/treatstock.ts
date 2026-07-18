const DEFAULT_BASE_URL = "https://api.treatstock.com/api/v2";

export interface TreatstockPack {
  id: number;
  redir: string;
  widgetUrl?: string;
  calculated_min_cost?: { materialGroup?: string; color?: string; cost?: number };
  [key: string]: unknown;
}

function privateKey(): string {
  const value = String(process.env.TREATSTOCK_PRIVATE_KEY || "").trim();
  if (!value) throw new Error("Treatstock printing is not configured.");
  return value;
}

function baseUrl(): string {
  return String(process.env.TREATSTOCK_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function parseResponse(response: Response): Promise<any> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || payload?.error || `Treatstock returned HTTP ${response.status}`);
  }
  return payload;
}

/**
 * Creates a Treatstock printable pack from a durable public STL URL. The
 * customer completes material, provider, payment, and shipping on Treatstock.
 * The private API key never reaches the browser.
 */
export async function createTreatstockPrintablePack(input: {
  stlUrl: string;
  country?: string;
}): Promise<TreatstockPack> {
  const key = privateKey();
  const country = String(input.country || "US").toUpperCase().slice(0, 2);
  const form = new FormData();
  form.append("fileUrls[]", input.stlUrl);
  form.append("location[country]", country);
  const response = await fetch(`${baseUrl()}/printable-packs/?private-key=${encodeURIComponent(key)}`, {
    method: "POST",
    body: form,
  });
  const payload = await parseResponse(response);
  if (!payload?.id || !payload?.redir) throw new Error("Treatstock did not return a printable-pack checkout URL.");
  return payload as TreatstockPack;
}

export async function getTreatstockPrintablePack(packId: number): Promise<TreatstockPack> {
  const key = privateKey();
  const response = await fetch(`${baseUrl()}/printable-packs/${packId}?private-key=${encodeURIComponent(key)}`);
  return await parseResponse(response) as TreatstockPack;
}

