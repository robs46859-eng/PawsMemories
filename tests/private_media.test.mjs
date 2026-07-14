import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPrivateMediaStore,
  readPrivateMediaConfig,
  storageKeyBelongsToOwner,
} from "../server/privateMediaStore.ts";

const CONFIG = {
  bucketName: "private-media-bucket",
  bucketEndpoint: "https://s3.us-west-004.backblazeb2.com",
  bucketRegion: "us-west-004",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  maxUploadBytes: 8,
  maxGetExpirySeconds: 600,
};

function createHarness() {
  const puts = [];
  const signedGets = [];
  const store = createPrivateMediaStore(CONFIG, {
    sendPutObject: async (command) => {
      puts.push(command);
      return {};
    },
    signGetObject: async (command, expiresInSeconds) => {
      signedGets.push({ command, expiresInSeconds });
      return `https://signed.invalid/object?expires=${expiresInSeconds}`;
    },
    now: () => 1_700_000_000_000,
    createId: () => "fixed-id",
  });
  return { store, puts, signedGets };
}

test("private media config is isolated from the legacy public bucket", () => {
  const config = readPrivateMediaConfig({
    PRIVATE_MEDIA_BUCKET_NAME: "bucket",
    PRIVATE_MEDIA_BUCKET_URL: "https://storage.invalid",
    PRIVATE_MEDIA_BUCKET_REGION: "us-west-004",
    PRIVATE_MEDIA_BUCKET_KEY: "key",
    PRIVATE_MEDIA_BUCKET_SECRET: "secret",
    MEDIA_BUCKET_NAME: "legacy-public-bucket",
  });

  assert.equal(config.bucketRegion, "us-west-004");
  assert.equal(config.bucketName, "bucket");
});

test("private uploads omit object ACLs and return only opaque metadata", async () => {
  const { store, puts } = createHarness();
  const uploaded = await store.uploadObject({
    ownerId: "owner-a@example.test",
    body: Buffer.from("media"),
    mimeType: "image/png",
    folder: "creations",
  });

  assert.equal(puts.length, 1);
  assert.equal("ACL" in puts[0].input, false);
  assert.equal(puts[0].input.Bucket, CONFIG.bucketName);
  assert.equal(puts[0].input.Key, uploaded.storageKey);
  assert.deepEqual(Object.keys(uploaded).sort(), ["contentType", "sizeBytes", "storageKey"]);

  const serialized = JSON.stringify(uploaded);
  assert.equal(serialized.includes(CONFIG.bucketEndpoint), false);
  assert.equal(serialized.includes(CONFIG.accessKeyId), false);
  assert.equal(serialized.includes(CONFIG.secretAccessKey), false);
  assert.equal(serialized.includes(CONFIG.bucketName), false);
});

test("owner-scoped keys isolate owners and reject unsafe paths", async () => {
  const { store } = createHarness();
  const ownerA = "owner-a@example.test";
  const ownerB = "owner-b@example.test";
  const objectA = await store.uploadObject({
    ownerId: ownerA,
    body: Buffer.from("a"),
    mimeType: "video/mp4",
    folder: "videos",
  });
  const objectB = await store.uploadObject({
    ownerId: ownerB,
    body: Buffer.from("b"),
    mimeType: "video/mp4",
    folder: "videos",
  });

  assert.notEqual(objectA.storageKey, objectB.storageKey);
  assert.equal(objectA.storageKey.includes(ownerA), false);
  assert.equal(objectB.storageKey.includes(ownerB), false);
  assert.equal(storageKeyBelongsToOwner(objectA.storageKey, ownerA), true);
  assert.equal(storageKeyBelongsToOwner(objectA.storageKey, ownerB), false);

  await assert.rejects(
    store.uploadObject({
      ownerId: ownerA,
      body: Buffer.from("a"),
      mimeType: "video/mp4",
      folder: "../owner-b",
    }),
    /invalid path segment/
  );
});

test("presigned GETs enforce owner scope and bounded expiry", async () => {
  const { store, signedGets } = createHarness();
  const ownerId = "owner-a@example.test";
  const uploaded = await store.uploadObject({
    ownerId,
    body: Buffer.from("media"),
    mimeType: "image/webp",
  });

  const url = await store.createPresignedGetUrl({
    ownerId,
    storageKey: uploaded.storageKey,
  });
  assert.equal(url, "https://signed.invalid/object?expires=300");
  assert.equal(signedGets[0].expiresInSeconds, 300);
  assert.equal(signedGets[0].command.input.Key, uploaded.storageKey);

  await assert.rejects(
    store.createPresignedGetUrl({
      ownerId,
      storageKey: uploaded.storageKey,
      expiresInSeconds: 601,
    }),
    /between 1 and 600 seconds/
  );
  await assert.rejects(
    store.createPresignedGetUrl({
      ownerId: "owner-b@example.test",
      storageKey: uploaded.storageKey,
    }),
    /does not belong/
  );
  assert.equal(signedGets.length, 1);
});

test("private uploads reject unsupported MIME types and oversized bodies before storage", async () => {
  const { store, puts } = createHarness();

  await assert.rejects(
    store.uploadObject({
      ownerId: "owner-a@example.test",
      body: Buffer.from("media"),
      mimeType: "text/html",
    }),
    /Unsupported media MIME type/
  );
  await assert.rejects(
    store.uploadObject({
      ownerId: "owner-a@example.test",
      body: Buffer.alloc(9),
      mimeType: "image/png",
    }),
    /8-byte limit/
  );

  assert.equal(puts.length, 0);
});
