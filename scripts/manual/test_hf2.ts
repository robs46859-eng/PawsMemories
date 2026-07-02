import { Client } from "@gradio/client";

async function run() {
  console.log("Fetching API for ashawkey/LGM...");
  try {
    const app = await Client.connect("ashawkey/LGM");
    const info = await app.view_api();
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.error("LGM error:", e);
  }
}
run();
