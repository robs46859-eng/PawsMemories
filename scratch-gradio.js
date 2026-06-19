import { client } from "@gradio/client";

async function main() {
  const app = await client("tencent/Hunyuan3D-2");
  console.log(JSON.stringify(app.config.dependencies, null, 2));
}
main().catch(console.error);
