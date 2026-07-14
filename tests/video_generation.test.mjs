import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_VIDEO_ASPECT_RATIO,
  DEFAULT_VIDEO_DURATION_SECONDS,
  DEFAULT_VIDEO_PROMPT,
  MAX_VIDEO_PROMPT_LENGTH,
  SUPPORTED_VIDEO_DURATION_SECONDS,
  VIDEO_ASPECT_RATIOS,
  VideoGenerationRequestSchema,
} from "../src/schemas/video.ts";
import {
  VIDEO_OUTPUT_DURATION_TOLERANCE_SECONDS,
  VideoGenerationValidationError,
  createVideoGenerationPipeline,
} from "../server/videoGeneration.ts";

process.env.PETSIM_RIG_ENABLED = "false";

const SOURCE = {
  id: 101,
  ownerId: "owner-a",
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/jpeg",
};

function validRequest(overrides = {}) {
  return {
    sourceImage: { id: SOURCE.id, ownerId: SOURCE.ownerId },
    prompt: "The pet turns toward the camera.",
    requestedDurationSeconds: 8,
    aspectRatio: "16:9",
    generateAudio: true,
    ...overrides,
  };
}

function createHarness(options = {}) {
  const calls = {
    loadSourceImage: 0,
    provider: 0,
    saveGeneratedVideo: 0,
    reservePaidUsage: 0,
  };
  const providerRequests = [];
  const savedInputs = [];

  const storage = {
    loadSourceImage: async () => {
      calls.loadSourceImage += 1;
      return options.source === undefined ? SOURCE : options.source;
    },
    saveGeneratedVideo: async (input) => {
      calls.saveGeneratedVideo += 1;
      savedInputs.push(input);
      return { id: "video-1", url: "memory://video-1.mp4" };
    },
  };

  const provider = {
    generateVideo: async (request) => {
      calls.provider += 1;
      providerRequests.push(request);
      if (options.providerOutput) return options.providerOutput;
      return {
        videoBytes: new Uint8Array([9, 8, 7]),
        mimeType: "video/mp4",
        actualDurationSeconds:
          options.actualDurationSeconds ?? request.requestedDurationSeconds,
        provider: "google",
        model: "veo-3.1-fast-generate-preview",
      };
    },
  };

  // This deliberately sits outside the pipeline contract. The foundation must
  // never reserve credits or paid usage; route wiring owns that behavior.
  const dependencies = {
    provider,
    storage,
    reservePaidUsage: async () => {
      calls.reservePaidUsage += 1;
    },
  };

  return {
    calls,
    providerRequests,
    savedInputs,
    generate: createVideoGenerationPipeline(dependencies),
  };
}

function expectValidationCode(code) {
  return (error) => {
    assert.ok(error instanceof VideoGenerationValidationError);
    assert.equal(error.code, code);
    return true;
  };
}

test("request contract defaults to a provider-supported eight-second landscape video", () => {
  const request = VideoGenerationRequestSchema.parse({
    sourceImage: { id: 101, ownerId: "owner-a" },
  });

  assert.deepEqual(SUPPORTED_VIDEO_DURATION_SECONDS, [8]);
  assert.equal(DEFAULT_VIDEO_DURATION_SECONDS, 8);
  assert.equal(request.requestedDurationSeconds, 8);
  assert.equal(request.aspectRatio, DEFAULT_VIDEO_ASPECT_RATIO);
  assert.equal(request.prompt, DEFAULT_VIDEO_PROMPT);
  assert.equal(request.generateAudio, true);
});

test("request contract supports only eight seconds and landscape/portrait ratios", () => {
  for (const requestedDurationSeconds of SUPPORTED_VIDEO_DURATION_SECONDS) {
    for (const aspectRatio of VIDEO_ASPECT_RATIOS) {
      const parsed = VideoGenerationRequestSchema.parse(
        validRequest({ requestedDurationSeconds, aspectRatio }),
      );
      assert.equal(parsed.requestedDurationSeconds, requestedDurationSeconds);
      assert.equal(parsed.aspectRatio, aspectRatio);
    }
  }

  assert.equal(
    VideoGenerationRequestSchema.safeParse(
      validRequest({ requestedDurationSeconds: 10 }),
    ).success,
    false,
    "exact 10 seconds remains deferred",
  );
});

test("invalid requests are rejected before source, provider, storage, or paid calls", async () => {
  const invalidRequests = [
    validRequest({ requestedDurationSeconds: 5 }),
    validRequest({ requestedDurationSeconds: 10 }),
    validRequest({ aspectRatio: "4:3" }),
    validRequest({ prompt: "   " }),
    validRequest({ prompt: "x".repeat(MAX_VIDEO_PROMPT_LENGTH + 1) }),
    validRequest({ sourceImage: { id: SOURCE.id } }),
    {
      sourceImageId: SOURCE.id,
      prompt: "Ownership-neutral IDs are not valid references.",
      aspectRatio: "16:9",
      generateAudio: false,
    },
  ];

  for (const input of invalidRequests) {
    const harness = createHarness();
    await assert.rejects(
      () => harness.generate(input),
      expectValidationCode("INVALID_REQUEST"),
    );
    assert.deepEqual(harness.calls, {
      loadSourceImage: 0,
      provider: 0,
      saveGeneratedVideo: 0,
      reservePaidUsage: 0,
    });
  }
});

test("an owner mismatch is rejected before the provider call", async () => {
  const harness = createHarness({
    source: { ...SOURCE, ownerId: "owner-b" },
  });

  await assert.rejects(
    () => harness.generate(validRequest()),
    expectValidationCode("SOURCE_NOT_FOUND_OR_NOT_OWNED"),
  );
  assert.equal(harness.calls.loadSourceImage, 1);
  assert.equal(harness.calls.provider, 0);
  assert.equal(harness.calls.saveGeneratedVideo, 0);
  assert.equal(harness.calls.reservePaidUsage, 0);
});

test("valid generation forwards normalized options and stores validated metadata", async () => {
  const harness = createHarness();
  const result = await harness.generate(
    validRequest({ requestedDurationSeconds: 8, aspectRatio: "9:16" }),
  );

  assert.deepEqual(harness.calls, {
    loadSourceImage: 1,
    provider: 1,
    saveGeneratedVideo: 1,
    reservePaidUsage: 0,
  });
  assert.deepEqual(harness.providerRequests[0], {
    sourceImage: {
      bytes: SOURCE.bytes,
      mimeType: SOURCE.mimeType,
    },
    prompt: "The pet turns toward the camera.",
    requestedDurationSeconds: 8,
    aspectRatio: "9:16",
    generateAudio: true,
  });
  assert.deepEqual(result.metadata, {
    requestedDurationSeconds: 8,
    actualDurationSeconds: 8,
    provider: "google",
    model: "veo-3.1-fast-generate-preview",
    aspectRatio: "9:16",
    validationStatus: "validated",
  });
  assert.deepEqual(harness.savedInputs[0].metadata, result.metadata);
  assert.deepEqual(result.storedVideo, {
    id: "video-1",
    url: "memory://video-1.mp4",
  });
});

test("duration variance at the documented tolerance is accepted", async () => {
  const actualDurationSeconds = 8 + VIDEO_OUTPUT_DURATION_TOLERANCE_SECONDS;
  const harness = createHarness({ actualDurationSeconds });

  const result = await harness.generate(validRequest());
  assert.equal(result.metadata.actualDurationSeconds, actualDurationSeconds);
  assert.equal(result.metadata.validationStatus, "validated");
  assert.equal(harness.calls.saveGeneratedVideo, 1);
});

test("duration variance beyond tolerance is rejected before storage", async () => {
  const actualDurationSeconds =
    8 + VIDEO_OUTPUT_DURATION_TOLERANCE_SECONDS + 0.001;
  const harness = createHarness({ actualDurationSeconds });

  await assert.rejects(() => harness.generate(validRequest()), (error) => {
    assert.ok(error instanceof VideoGenerationValidationError);
    assert.equal(error.code, "OUTPUT_DURATION_MISMATCH");
    assert.deepEqual(error.metadata, {
      requestedDurationSeconds: 8,
      actualDurationSeconds,
      provider: "google",
      model: "veo-3.1-fast-generate-preview",
      aspectRatio: "16:9",
      validationStatus: "rejected",
    });
    return true;
  });

  assert.equal(harness.calls.provider, 1);
  assert.equal(harness.calls.saveGeneratedVideo, 0);
  assert.equal(harness.calls.reservePaidUsage, 0);
});

test("malformed provider output is rejected before storage", async () => {
  const harness = createHarness({
    providerOutput: {
      videoBytes: new Uint8Array(),
      mimeType: "application/octet-stream",
      actualDurationSeconds: 8,
      provider: "google",
      model: "veo-3.1-fast-generate-preview",
    },
  });

  await assert.rejects(
    () => harness.generate(validRequest()),
    expectValidationCode("INVALID_PROVIDER_OUTPUT"),
  );
  assert.equal(harness.calls.provider, 1);
  assert.equal(harness.calls.saveGeneratedVideo, 0);
});
