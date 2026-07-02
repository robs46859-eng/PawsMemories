import { client } from "@gradio/client";

async function main() {
  const app = await client("tencent/Hunyuan3D-2");
  const info = await app.view_api();
  // view_api returns an object with named_endpoints
  console.log(JSON.stringify(info, null, 2));
}
main().catch(console.error);
