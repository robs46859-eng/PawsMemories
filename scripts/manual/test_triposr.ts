import { Client } from "@gradio/client";

async function run() {
  console.log("Testing TripoSR generation...");
  try {
    const app = await Client.connect("stabilityai/TripoSR");
    
    // Create a dummy 1x1 image blob
    const buf = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", "base64");
    const blob = new Blob([buf], { type: "image/png" });

    console.log("Calling /preprocess...");
    const prepResult = await app.predict("/preprocess", [
      blob,
      true, // remove background
      0.85  // foreground ratio
    ]);
    console.log("Preprocess returned:", prepResult.data);

    // Get the preprocessed image path/blob
    const processedImg = prepResult.data[0];

    console.log("Calling /generate...");
    const genResult = await app.predict("/generate", [
      processedImg, // image
      256 // marching cubes resolution
    ]);
    console.log("Generate returned:", genResult.data);

  } catch (e) {
    console.error("TripoSR error:", e);
  }
}
run();
