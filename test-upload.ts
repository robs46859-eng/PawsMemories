import { uploadBase64Image } from './storage';
async function run() {
  try {
    const base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    console.log("Starting upload...");
    const url = await uploadBase64Image(base64);
    console.log("Success! URL:", url);
  } catch (err) {
    console.error("Upload failed:", err);
  }
}
run();
