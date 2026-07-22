import assert from "node:assert/strict";
import test from "node:test";
import { createHttpFurBinV5Api } from "../src/components/fur-bin-v5/client.ts";
import {
  archivePrivateItem,
  formatBytes,
  formatDimensions,
  loadPrivateLibrary,
  mergeItem,
  normalizeLibraryFilters,
  publishPublicDerivative,
  refreshSignedView,
  rollbackToVersion,
} from "../src/components/fur-bin-v5/workflows.ts";

const ITEM_UUID = "11111111-1111-4111-8111-111111111111";
const DERIVATIVE_UUID = "22222222-2222-4222-8222-222222222222";
const SHOWCASE_UUID = "33333333-3333-4333-8333-333333333333";

function itemFixture(overrides = {}) {
  return {
    itemUuid: ITEM_UUID,
    title: "Milo portrait model",
    description: "Accepted private source",
    tags: ["dog", "portrait"],
    dimensions: { width: 0.5, height: 0.8, depth: 0.4, unit: "m" },
    badges: [
      { id: "rig", label: "Body rig", state: "verified", evidenceLabel: "Manifest rule RIG-01" },
      { id: "facial", label: "Facial rig", state: "not_verified", evidenceLabel: "No measured facial evidence" },
      { id: "animation", label: "Animation", state: "verified", evidenceLabel: "Manifest rule ANIM-01" },
    ],
    accessoryCount: 1,
    derivativeCount: 1,
    storageBytes: 2_621_440,
    status: "active",
    signedViewUrl: "https://signed.test/private-v2.glb",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    currentVersionNumber: 2,
    versions: [
      { versionNumber: 2, createdAt: "2026-07-20T00:00:00.000Z", sizeBytes: 2_621_440, mimeType: "model/gltf-binary", isCurrent: true },
      { versionNumber: 1, createdAt: "2026-07-01T00:00:00.000Z", sizeBytes: 2_097_152, mimeType: "model/gltf-binary", isCurrent: false },
    ],
    derivatives: [
      { derivativeUuid: DERIVATIVE_UUID, versionNumber: 1, label: "Showcase-ready Milo", scope: "public", purpose: "showcase", validationLabel: "Public derivative verified" },
    ],
    ...overrides,
  };
}

function showcaseFixture() {
  return {
    showcaseUuid: SHOWCASE_UUID,
    title: "Milo in the park",
    description: "Approved public derivative",
    tags: ["dog"],
    category: "pets",
    attribution: "Pawsome3D",
    rightsDeclaration: "all_rights_reserved",
    commercialEligible: false,
    moderationState: "approved",
    viewCount: 12,
    publishedAt: "2026-07-21T00:00:00.000Z",
    publicViewUrl: "https://public.test/milo.glb",
    createdAt: "2026-07-20T00:00:00.000Z",
  };
}

function fixtureApi() {
  const calls = [];
  let current = itemFixture();
  const api = {
    capabilities: {
      listCollections: true,
      versionHistory: true,
      rollbackByVersionNumber: true,
      archive: true,
      separatePublicDerivative: true,
      ownerShowcaseLookup: true,
    },
    async searchItems(filters) {
      calls.push(["searchItems", filters]);
      return { items: [current], total: 1 };
    },
    async getItem(uuid) {
      calls.push(["getItem", uuid]);
      current = itemFixture({ signedViewUrl: "https://signed.test/refreshed.glb" });
      return current;
    },
    async listCollections() {
      calls.push(["listCollections"]);
      return [{ collectionUuid: "44444444-4444-4444-8444-444444444444", name: "Favorites", description: null }];
    },
    async createCollection(input) {
      calls.push(["createCollection", input]);
      return { collectionUuid: "55555555-5555-4555-8555-555555555555", name: input.name, description: input.description || null };
    },
    async addItemToCollection(collectionUuid, itemUuid) {
      calls.push(["addItemToCollection", collectionUuid, itemUuid]);
    },
    async rollbackVersion(itemUuid, versionNumber) {
      calls.push(["rollbackVersion", itemUuid, versionNumber]);
      current = itemFixture({ currentVersionNumber: versionNumber, versions: current.versions.map((version) => ({ ...version, isCurrent: version.versionNumber === versionNumber })) });
      return current;
    },
    async archiveItem(itemUuid) {
      calls.push(["archiveItem", itemUuid]);
      current = itemFixture({ status: "archived" });
      return current;
    },
    async publishShowcase(input) {
      calls.push(["publishShowcase", input]);
      return showcaseFixture();
    },
    async unpublishShowcase(showcaseUuid) {
      calls.push(["unpublishShowcase", showcaseUuid]);
    },
    async getPublicShowcase(showcaseUuid) {
      calls.push(["getPublicShowcase", showcaseUuid]);
      return showcaseFixture();
    },
  };
  return { api, calls };
}

test("Phase 5 UI workflows normalize filters and use an injected API", async () => {
  const { api, calls } = fixtureApi();
  const page = await loadPrivateLibrary(api, { query: "  Milo  ", tag: " DOG ", page: 0, limit: 500 });
  assert.equal(page.total, 1);
  assert.deepEqual(calls[0], ["searchItems", { query: "Milo", tag: "dog", collectionUuid: undefined, hasRig: undefined, hasFacial: undefined, hasAnimations: undefined, page: 1, limit: 100 }]);
  assert.deepEqual(normalizeLibraryFilters({ limit: -3 }), { query: undefined, tag: undefined, collectionUuid: undefined, hasRig: undefined, hasFacial: undefined, hasAnimations: undefined, page: 1, limit: 1 });
});

test("Phase 5 UI refreshes signed URLs and rolls back by public version number", async () => {
  const { api, calls } = fixtureApi();
  const refreshed = await refreshSignedView(api, ITEM_UUID);
  assert.equal(refreshed.signedViewUrl, "https://signed.test/refreshed.glb");
  const rolledBack = await rollbackToVersion(api, ITEM_UUID, 1);
  assert.equal(rolledBack.currentVersionNumber, 1);
  assert.deepEqual(calls.at(-1), ["rollbackVersion", ITEM_UUID, 1]);
  assert.equal(Object.hasOwn(calls.at(-1), "targetVersionId"), false);
});

test("Phase 5 UI archives private records without deleting and publishes a separate derivative", async () => {
  const { api, calls } = fixtureApi();
  const archived = await archivePrivateItem(api, ITEM_UUID);
  assert.equal(archived.status, "archived");

  const published = await publishPublicDerivative(api, {
    itemUuid: ITEM_UUID,
    publicDerivativeUuid: DERIVATIVE_UUID,
    publicDerivativeVersionNumber: 1,
    title: "Milo in the park",
    tags: ["dog"],
    category: "pets",
    rightsDeclaration: "all_rights_reserved",
    commercialEligible: false,
  });
  assert.equal(published.showcaseUuid, SHOWCASE_UUID);
  assert.deepEqual(calls.at(-1)[1].publicDerivativeUuid, DERIVATIVE_UUID);
  await assert.rejects(() => publishPublicDerivative(api, {
    itemUuid: ITEM_UUID,
    publicDerivativeUuid: "",
    publicDerivativeVersionNumber: 0,
    title: "Unsafe",
    tags: [],
    category: "pets",
    rightsDeclaration: "all_rights_reserved",
    commercialEligible: false,
  }), /validated public derivative/i);
});

test("Phase 5 display helpers and immutable item replacement are deterministic", () => {
  const original = itemFixture();
  const updated = itemFixture({ title: "Milo v2" });
  assert.equal(formatBytes(original.storageBytes), "2.5 MB");
  assert.equal(formatDimensions(original), "0.5 × 0.8 × 0.4 m");
  assert.equal(formatDimensions(itemFixture({ dimensions: null })), "Dimensions not measured");
  const result = mergeItem([original, itemFixture({ itemUuid: "66666666-6666-4666-8666-666666666666" })], updated);
  assert.equal(result[0].title, "Milo v2");
  assert.equal(result.length, 2);
});

test("default HTTP adapter maps completed Phase 5 routes and measured evidence", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ input: String(input), init });
    if (String(input).includes("/items?")) {
      return new Response(JSON.stringify({
        items: [itemFixture()],
        total: 1,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input).endsWith("/collections")) {
      return new Response(JSON.stringify([{ collectionUuid: DERIVATIVE_UUID, name: "Favorites", description: null, itemCount: 1 }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input).endsWith("/rollback")) {
      return new Response(JSON.stringify(itemFixture({ currentVersionNumber: 1 })), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input).endsWith("/archive")) {
      return new Response(JSON.stringify(itemFixture({ status: "archived" })), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/fur-bin/showcase" && init.method === "POST") {
      return new Response(JSON.stringify(showcaseFixture()), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input).includes("/showcase/") && init.method !== "POST") {
      return new Response(JSON.stringify(showcaseFixture()), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${input}`);
  };

  try {
    const api = createHttpFurBinV5Api();
    const result = await api.searchItems({ query: "Milo", hasRig: true });
    const rigBadge = result.items[0].badges.find((badge) => badge.id === "rig");
    assert.equal(rigBadge.state, "verified");
    assert.equal(result.items[0].versions.length, 2);
    assert.match(requests[0].input, /^\/api\/fur-bin\/items\?/);
    assert.match(requests[0].input, /hasRig=true/);
    assert.equal((await api.getPublicShowcase(SHOWCASE_UUID)).moderationState, "approved");
    assert.equal((await api.listCollections())[0].itemCount, 1);
    assert.equal((await api.rollbackVersion(ITEM_UUID, 1)).currentVersionNumber, 1);
    assert.equal((await api.archiveItem(ITEM_UUID)).status, "archived");
    assert.equal((await api.publishShowcase({
      itemUuid: ITEM_UUID,
      publicDerivativeUuid: DERIVATIVE_UUID,
      publicDerivativeVersionNumber: 1,
      title: "Milo",
      tags: ["dog"],
      category: "pets",
      rightsDeclaration: "all_rights_reserved",
      commercialEligible: false,
    })).showcaseUuid, SHOWCASE_UUID);
    const rollbackRequest = requests.find((request) => request.input.endsWith("/rollback"));
    assert.deepEqual(JSON.parse(rollbackRequest.init.body), { versionNumber: 1 });
    assert.equal(Object.hasOwn(JSON.parse(rollbackRequest.init.body), "targetVersionId"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
