import crypto from "crypto";
import { FulfillmentAdapter, FulfillmentProduct, NormalizedAddress, OrderSnapshot, ProviderOrderResult, QuoteResult, WebhookEvent } from "./types";

const PRODIGI_API_URL = "https://api.prodigi.com/v4.0"; // v4 is standard

const SKU_TO_PRODIGI_SKU: Record<string, string> = {
  "pawprint_5x7": "GLOBAL-FAP-5x7" // Example prodigi sku
};

export class ProdigiAdapter implements FulfillmentAdapter {
  providerName = "prodigi" as const;
  private apiKey = process.env.PRODIGI_API_KEY || "";

  private get headers() {
    return {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json"
    };
  }

  async quote(product: FulfillmentProduct, destination: NormalizedAddress): Promise<QuoteResult> {
    const pSku = SKU_TO_PRODIGI_SKU[product.sku];
    if (!pSku) throw new Error(`Prodigi: Unknown SKU ${product.sku}`);

    const res = await fetch(`${PRODIGI_API_URL}/Quotes`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        destinationCountryCode: destination.countryCode,
        currencyCode: "USD",
        items: [{ sku: pSku, copies: product.quantity }]
      })
    });

    if (!res.ok) {
      console.warn("[fulfillment] Prodigi quote failed:", await res.text());
      if (!this.apiKey) return { costBase: 400, costShipping: 300, costTax: 40, currency: "USD", provider: "prodigi" };
      throw new Error("Failed to get quote from Prodigi");
    }

    const json = await res.json();
    const quote = json.quotes[0];
    
    // Prodigi returns amount in standard decimal (e.g., "4.50")
    return {
      costBase: Math.round(parseFloat(quote.itemCost) * 100),
      costShipping: Math.round(parseFloat(quote.shippingCost) * 100),
      costTax: Math.round(parseFloat(quote.taxCost) * 100),
      currency: "USD",
      provider: "prodigi"
    };
  }

  async createOrder(order: OrderSnapshot): Promise<ProviderOrderResult> {
    const pSku = SKU_TO_PRODIGI_SKU[order.product.sku];
    
    if (!this.apiKey) {
      return {
        providerOrderReference: `mock_prodigi_${Date.now()}`,
        status: "accepted"
      };
    }

    const res = await fetch(`${PRODIGI_API_URL}/Orders`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        merchantReference: order.orderId,
        shippingMethod: "Budget",
        recipient: {
          name: order.shippingAddress.name,
          address: {
            line1: order.shippingAddress.address1,
            line2: order.shippingAddress.address2 || "",
            postalOrZipCode: order.shippingAddress.zip,
            countryCode: order.shippingAddress.countryCode,
            townOrCity: order.shippingAddress.city,
            stateOrCounty: order.shippingAddress.state
          }
        },
        items: [{
          sku: pSku,
          copies: order.product.quantity,
          assets: [{ printArea: "default", url: order.product.customFileUrl }]
        }]
      })
    });

    if (!res.ok) throw new Error(`Prodigi createOrder failed: ${await res.text()}`);

    const json = await res.json();
    return {
      providerOrderReference: json.order.id,
      status: json.order.status.stage
    };
  }

  async getOrder(providerOrderReference: string): Promise<ProviderOrderResult> {
    if (!this.apiKey) return { providerOrderReference, status: "Shipped", trackingNumber: "MOCK456" };

    const res = await fetch(`${PRODIGI_API_URL}/Orders/${providerOrderReference}`, { headers: this.headers });
    if (!res.ok) throw new Error("Failed to get order from Prodigi");
    
    const json = await res.json();
    return {
      providerOrderReference,
      status: json.order.status.stage
    };
  }

  async cancelOrder(providerOrderReference: string): Promise<void> {
    if (!this.apiKey) return;
    const res = await fetch(`${PRODIGI_API_URL}/Orders/${providerOrderReference}/actions/cancel`, { method: "POST", headers: this.headers });
    if (!res.ok) throw new Error("Failed to cancel order");
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    // Prodigi provides a webhook secret to hash the body
    const secret = process.env.PRODIGI_WEBHOOK_SECRET;
    if (!secret) return true; // Mock mode
    
    const hmac = crypto.createHmac('sha256', secret);
    const calculated = hmac.update(rawBody).digest('base64');
    return calculated === signature;
  }

  normalizeWebhook(rawPayload: any): WebhookEvent | null {
    const data = rawPayload.data;
    if (!data) return null;
    
    if (data.status?.stage === 'Shipped') {
      return {
        providerOrderReference: data.id,
        status: 'shipped'
      };
    }
    if (data.status?.stage === 'Cancelled') {
      return {
        providerOrderReference: data.id,
        status: 'canceled'
      };
    }
    return null;
  }
}
