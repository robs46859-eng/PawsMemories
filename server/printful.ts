/** Small Printful adapter for Pawprint physical orders.
 * Product/template IDs stay in deployment configuration so the website
 * layouts can be mapped to the exact Printful product chosen by the owner.
 */
export interface PrintfulOrderInput {
  recipient: { name: string; email: string; address1: string; city: string; state_code?: string; country_code: string; zip: string };
  imageUrl: string;
  variantId?: number;
  quantity?: number;
}

export async function createPrintfulOrder(input: PrintfulOrderInput): Promise<{ id: string; status: string }> {
  const token = process.env.PRINTFUL_API_KEY || "";
  const variantId = Number(input.variantId || process.env.PRINTFUL_PAWPRINT_VARIANT_ID || 0);
  const templateId = Number(process.env.PRINTFUL_PAWPRINT_TEMPLATE_ID || 0);
  if (!token || !variantId) throw new Error("Printful is not configured: set PRINTFUL_API_KEY and PRINTFUL_PAWPRINT_VARIANT_ID.");
  const base = (process.env.PRINTFUL_API_BASE_URL || "https://api.printful.com").replace(/\/$/, "");
  const response = await fetch(`${base}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(process.env.PRINTFUL_STORE_ID ? { "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID } : {}),
    },
    body: JSON.stringify({
      recipient: input.recipient,
      items: [{ variant_id: variantId, ...(templateId ? { product_template_id: templateId } : {}), quantity: input.quantity || 1, files: [{ type: "default", url: input.imageUrl }] }],
      confirm: process.env.PRINTFUL_AUTO_CONFIRM === "true",
    }),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `Printful returned ${response.status}.`);
  return { id: String(payload?.result?.id || payload?.id || ""), status: String(payload?.result?.status || payload?.status || "draft") };
}
