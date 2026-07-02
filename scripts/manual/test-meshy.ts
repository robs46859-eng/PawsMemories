import { startImageTo3D } from './meshy';
async function run() {
  try {
    const base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const handle = await startImageTo3D({ imageUrl: base64 });
    console.log("Success! Handle:", handle);
  } catch (err) {
    console.error("Meshy failed:", err);
  }
}
run();
