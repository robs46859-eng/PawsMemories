export interface NormalizedAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string; // state/region
  countryCode: string; // ISO 3166-1 alpha-2
  zip: string;
  phone?: string;
  email?: string;
}

export interface FulfillmentProduct {
  sku: string; // Internal SKU mapped to provider SKU
  quantity: number;
  customFileUrl?: string; // High-res image to print
}

export interface QuoteResult {
  costBase: number;
  costShipping: number;
  costTax: number;
  currency: string;
  provider: "prodigi";
}

export interface OrderSnapshot {
  orderId: string;
  product: FulfillmentProduct;
  shippingAddress: NormalizedAddress;
}

export interface ProviderOrderResult {
  providerOrderReference: string;
  status: string;
  trackingNumber?: string;
  trackingUrl?: string;
}

export interface WebhookEvent {
  providerOrderReference: string;
  status: 'accepted' | 'in_production' | 'shipped' | 'delivered' | 'failed' | 'canceled';
  trackingNumber?: string;
  trackingUrl?: string;
}

export interface FulfillmentAdapter {
  providerName: "prodigi";
  quote(product: FulfillmentProduct, destination: NormalizedAddress): Promise<QuoteResult>;
  createOrder(order: OrderSnapshot): Promise<ProviderOrderResult>;
  getOrder(providerOrderReference: string): Promise<ProviderOrderResult>;
  cancelOrder(providerOrderReference: string): Promise<void>;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
  normalizeWebhook(rawPayload: any): WebhookEvent | null;
}
