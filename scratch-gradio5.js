import { client, handle_file } from "@gradio/client";

async function main() {
  const app = await client("tencent/Hunyuan3D-2");
  console.log("Submitting prediction...");
  const result = await app.predict("/shape_generation", [
		"", // caption
		handle_file("https://raw.githubusercontent.com/gradio-app/gradio/main/test/test_files/bus.png"), // image
		null, // mv front
		null, // mv back
		null, // mv left
		null, // mv right
		30, // steps
		5, // guidance
		1234, // seed
		256, // octree
		true, // rembg
		8000, // chunks
		true, // random seed
  ]);
  console.log("Result:");
  console.log(JSON.stringify(result.data, null, 2));
}
main().catch(console.error);
