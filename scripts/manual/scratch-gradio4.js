import { client } from "@gradio/client";

async function main() {
  const app = await client("tencent/Hunyuan3D-2");
  const info = await app.view_api();
  console.log(JSON.stringify(info.named_endpoints["/shape_generation"], null, 2));
}
main().catch(console.error);
