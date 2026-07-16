import { QuoteResult } from "./fulfillment/types";

// Minimum acceptable margin in cents (e.g., $2.00)
const MIN_MARGIN_CENTS = 200;
// Fixed markup in cents
const FIXED_MARKUP = 300; 
// Percentage markup
const PERCENT_MARKUP = 0.20;

export interface RetailPricing {
  cost: number;
  margin: number;
  shipping_cost: number;
  tax: number;
  total_price: number;
  currency: string;
}

/**
 * Calculates the retail price for a given provider quote.
 * Enforces a minimum margin to ensure non-negative or loss-making transactions.
 */
export function calculateRetailPrice(quote: QuoteResult): RetailPricing {
  const { costBase, costShipping, costTax, currency } = quote;

  // Calculate markup: Base cost * percentage + fixed markup
  let margin = Math.round(costBase * PERCENT_MARKUP) + FIXED_MARKUP;

  // Enforce minimum margin rule
  if (margin < MIN_MARGIN_CENTS) {
    margin = MIN_MARGIN_CENTS;
  }

  const totalPrice = costBase + costShipping + costTax + margin;

  // Defense in depth: absolute final check to ensure we never lose money
  const actualMargin = totalPrice - (costBase + costShipping + costTax);
  if (actualMargin < 0) {
    throw new Error("Pricing Engine Error: Calculated price results in a negative margin.");
  }

  return {
    cost: costBase,
    margin: actualMargin,
    shipping_cost: costShipping,
    tax: costTax,
    total_price: totalPrice,
    currency
  };
}
