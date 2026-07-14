import assert from "node:assert/strict";
import test from "node:test";
import { readResponseBodyBounded } from "../server/httpBody.ts";

test("bounded response reader accepts a body at the byte ceiling", async () => {
  const response = new Response(Buffer.from("paws"), {
    headers: { "content-length": "4" },
  });
  assert.equal((await readResponseBodyBounded(response, 4)).toString("utf8"), "paws");
});

test("bounded response reader rejects declared and streamed overflow", async () => {
  await assert.rejects(
    () => readResponseBodyBounded(new Response("large", { headers: { "content-length": "5" } }), 4),
    /size limit/,
  );
  const streamed = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  }));
  await assert.rejects(() => readResponseBodyBounded(streamed, 5), /size limit/);
});

test("bounded response reader rejects empty bodies and invalid limits", async () => {
  await assert.rejects(() => readResponseBodyBounded(new Response(null), 10), /no body/);
  await assert.rejects(() => readResponseBodyBounded(new Response("paws"), 0), /positive integer/);
});
