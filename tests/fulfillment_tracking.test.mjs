import assert from "node:assert/strict";
import test from "node:test";
import { extractShipmentTracking } from "../server/fulfillmentTracking.ts";

test("extracts Printful shipment fields without exposing the provider payload", () => {
  const result = extractShipmentTracking({
    recipient: { name: "Private Name", address1: "Private address" },
    shipments: [{
      carrier: "FEDEX",
      service: "SmartPost",
      tracking_number: "0000000000",
      tracking_url: "https://fedex.example/track/0000000000",
      shipped_at: 1_588_716_060,
    }],
  });
  assert.deepEqual(result, [{
    carrier: "FEDEX",
    service: "SmartPost",
    trackingNumber: "0000000000",
    trackingUrl: "https://fedex.example/track/0000000000",
    shippedAt: "2020-05-05T22:01:00.000Z",
  }]);
  assert.equal(JSON.stringify(result).includes("Private"), false);
});

test("extracts nested Slant-style tracking and rejects unsafe URLs", () => {
  const result = extractShipmentTracking(JSON.stringify({
    data: { order: { fulfillment: {
      carrier: "USPS",
      trackingNumber: "9400",
      trackingURL: "javascript:alert(1)",
    } } },
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0].carrier, "USPS");
  assert.equal(result[0].trackingNumber, "9400");
  assert.equal(result[0].trackingUrl, null);
});

test("deduplicates repeated shipment records and ignores unrelated objects", () => {
  const shipment = { tracking_number: "ABC", tracking_url: "https://carrier.example/ABC" };
  const result = extractShipmentTracking({ data: { shipments: [shipment, shipment] }, costs: { total: 10 } });
  assert.equal(result.length, 1);
});
