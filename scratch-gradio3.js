import { client, handle_file } from "@gradio/client";

async function main() {
  const app = await client("tencent/Hunyuan3D-2");
  console.log("Starting prediction...");
  const result = await app.predict("/shape_generation", [
		handle_file('https://raw.githubusercontent.com/gradio-app/gradio/main/test/test_files/bus.png'), // image
		true, // remove background
		0, // seed
		true, // randomize seed
		"Turbo", // generation mode
		50, // steps
		4, // guidance
		"Standard", // decode mode
		256, // octree
		256, // mc resolution
		true, // clean
		100000, // max faces
		true, // keep largest
  ]);
  console.log("Output:");
  console.log(JSON.stringify(result.data, null, 2));
}
main().catch(console.error);
