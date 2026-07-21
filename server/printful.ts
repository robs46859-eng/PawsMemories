/** Small Printful adapter for Pawprint physical orders.
 * Product/template IDs stay in deployment configuration so the website
 * layouts can be mapped to the exact Printful product chosen by the owner.
 */
export interface PrintfulOrderInput {
  recipient: { name: string; email: string; address1: string; city: string; state_code?: string; country_code: string; zip: string };
  imageUrl: string;
  variantId?: number;
  templateId?: number;
  quantity?: number;
  externalId: string;
}

export interface PrintfulOrderResult {
  id: string;
  status: string;
  dashboardUrl?: string;
  costs?: { currency?: string; subtotal?: string; shipping?: string; tax?: string; total?: string };
}

function configuration() {
  const token = process.env.PRINTFUL_API_KEY || "";
  const base = (process.env.PRINTFUL_API_BASE_URL || "https://api.printful.com").replace(/\/$/, "");
  if (!token) throw new Error("Printful is not configured: set PRINTFUL_API_KEY.");
  return {
    token,
    base,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(process.env.PRINTFUL_STORE_ID ? { "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID } : {}),
    },
  };
}

async function parsePrintful(response: Response): Promise<any> {
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `Printful returned ${response.status}.`);
  return payload?.result || payload || {};
}

/** Non-mutating authentication/store-context check for the admin deployment gate. */
export async function verifyPrintfulConfiguration(): Promise<{
  authenticated: true;
  storeContext: "explicit" | "token";
  ordersReadable: boolean;
}> {
  const { base, headers } = configuration();
  const result = await parsePrintful(await fetch(`${base}/orders?limit=1&offset=0`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  }));
  return {
    authenticated: true,
    storeContext: process.env.PRINTFUL_STORE_ID ? "explicit" : "token",
    ordersReadable: Array.isArray(result) || Boolean(result && typeof result === "object"),
  };
}

export async function createPrintfulOrder(input: PrintfulOrderInput): Promise<PrintfulOrderResult> {
  const { base, headers } = configuration();
  const variantId = Number(input.variantId || process.env.PRINTFUL_PAWPRINT_VARIANT_ID || 0);
  const templateId = Number(input.templateId || process.env.PRINTFUL_PAWPRINT_TEMPLATE_ID || 0);
  if (!variantId) throw new Error("Printful is not configured: set a Pawprint variant ID.");
  // Always draft first. Production is confirmed only after Stripe reports that
  // the customer payment succeeded.
  const response = await fetch(`${base}/orders?confirm=false&update_existing=true`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      external_id: input.externalId,
      recipient: input.recipient,
      items: [{ variant_id: variantId, ...(templateId ? { product_template_id: templateId } : {}), quantity: input.quantity || 1, files: [{ type: "default", url: input.imageUrl }] }],
    }),
  });
  const result = await parsePrintful(response);
  return {
    id: String(result.id || ""),
    status: String(result.status || "draft"),
    dashboardUrl: result.dashboard_url ? String(result.dashboard_url) : undefined,
    costs: result.costs,
  };
}

export async function getPrintfulOrder(orderId: string): Promise<any> {
  const { base, headers } = configuration();
  return await parsePrintful(await fetch(`${base}/orders/${encodeURIComponent(orderId)}`, { headers, signal: AbortSignal.timeout(30_000) }));
}

export async function confirmPrintfulOrderIfDraft(orderId: string): Promise<any> {
  const current = await getPrintfulOrder(orderId);
  const status = String(current?.status || "").toLowerCase();
  if (status && status !== "draft" && status !== "failed") return current;
  const { base, headers } = configuration();
  return await parsePrintful(await fetch(`${base}/orders/${encodeURIComponent(orderId)}/confirm`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(60_000) }));
}
