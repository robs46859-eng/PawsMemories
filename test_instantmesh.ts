import { Client } from "@gradio/client";
import * as fs from "fs";

async function run() {
  console.log("Testing InstantMesh generation...");
  try {
    const app = await Client.connect("TencentARC/InstantMesh");
    
    const buf = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", "base64");
    const blob = new Blob([buf], { type: "image/png" });

    console.log("Calling /make3d...");
    const genResult = await app.predict("/make3d", [
      null // state object from preprocess... wait I need state?
    ]);
    console.log("Generate returned:", genResult.data);

  } catch (e) {
    console.error("InstantMesh error:", e);
  }
}
run();
