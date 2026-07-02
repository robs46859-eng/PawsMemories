import { Client } from "@gradio/client";

async function run() {
  console.log("Fetching API for stabilityai/TripoSR...");
  try {
    const app = await Client.connect("stabilityai/TripoSR");
    const info = await app.view_api();
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.error("TripoSR error:", e);
  }
}
run();
