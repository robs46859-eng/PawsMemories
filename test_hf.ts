import { Client } from "@gradio/client";

async function run() {
  console.log("Fetching API for TencentARC/InstantMesh...");
  try {
    const app = await Client.connect("TencentARC/InstantMesh");
    const info = await app.view_api();
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.error(e);
  }
}
run();
