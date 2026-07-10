import fs from "fs";
import path from "path";
import { uploadBase64Binary } from "../storage.ts";
import { fileURLToPath } from "url";

// Helper to resolve directory paths in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_DIR = path.join(__dirname, "..", "server", "animator", "environments");

// 1. Procedural Studio (Basic Tier)
const basicStudio = {
  id: "procedural-studio",
  tier: "basic",
  label: "Clean Studio",
  backdrop: {
    kind: "procedural"
  },
  allowedWeather: ["clear"],
  defaultTimeOfDay: "afternoon",
  license: "generated",
  source: "PawsMemories Defaults"
};

// 2. Generic Outdoor (PolyHaven / OpenHDRI CC0)
// Using an existing URL that is known to be CC0. We will upload it to Backblaze.
const outdoorGeneric = {
  id: "generic-outdoor-park",
  tier: "generic",
  label: "Sunny Park",
  backdrop: {
    kind: "hdri",
    url: "" // Filled below
  },
  allowedWeather: ["clear", "rain", "fog", "overcast", "snow"],
  defaultTimeOfDay: "afternoon",
  license: "CC0",
  source: "ambientCG",
  sourceUrl: "https://ambientcg.com/view?id=OutdoorHDRI001" // Example, we will fetch real
};

// We will fetch 3 actual CC0 HDRIs (as JPGs/HDRs for Equirectangular) directly from CC0 sources for this script.
// To avoid zip extraction complexity in a simple script, we'll use known direct CC0 links from Poly Haven's API (which ambientCG also pulls from sometimes or vice versa), 
// PolyHaven provides direct file links.

async function fetchAndUpload(url, filename, mimeType = "image/jpeg") {
  console.log(`Downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  console.log(`Downloaded ${buffer.byteLength} bytes.`);
  
  try {
    const base64Str = Buffer.from(buffer).toString("base64");
    const bucketUrl = await uploadBase64Binary(base64Str, mimeType);
    console.log(`Uploaded to: ${bucketUrl}`);
    return bucketUrl;
  } catch (err) {
    console.warn("Storage upload failed, falling back to local animator-files", err.message);
    const pubDir = path.join(__dirname, "..", "data", "animator", "environments");
    if (!fs.existsSync(pubDir)) fs.mkdirSync(pubDir, { recursive: true });
    
    const absPath = path.join(pubDir, filename);
    fs.writeFileSync(absPath, Buffer.from(buffer));
    return `/animator-files/environments/${filename}`;
  }
}

async function main() {
  if (!fs.existsSync(ENV_DIR)) {
    fs.mkdirSync(ENV_DIR, { recursive: true });
  }

  // Write basic procedural
  fs.writeFileSync(path.join(ENV_DIR, "procedural-studio.json"), JSON.stringify(basicStudio, null, 2));
  console.log("Written basic studio preset.");

  // Poly Haven CC0 direct links (2k/4k Tone mapped JPGs for performance)
  // 1. Generic Outdoor: "kloppenheim_02" (a nice clear sky)
  const outdoorUrl = await fetchAndUpload("https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/kloppenheim_02.jpg", "kloppenheim_02.jpg", "image/jpeg");
  outdoorGeneric.backdrop.url = outdoorUrl;
  outdoorGeneric.source = "Poly Haven";
  outdoorGeneric.sourceUrl = "https://polyhaven.com/a/kloppenheim_02";
  fs.writeFileSync(path.join(ENV_DIR, "generic-outdoor-park.json"), JSON.stringify(outdoorGeneric, null, 2));

  // 2. Generic Indoor: "studio_small_08"
  const indoorUrl = await fetchAndUpload("https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/studio_small_08.jpg", "studio_small_08.jpg", "image/jpeg");
  const indoorGeneric = {
    id: "generic-indoor-studio",
    tier: "generic",
    label: "Warm Studio",
    backdrop: {
      kind: "hdri",
      url: indoorUrl
    },
    allowedWeather: ["clear"], // no rain indoors
    defaultTimeOfDay: "afternoon",
    license: "CC0",
    source: "Poly Haven",
    sourceUrl: "https://polyhaven.com/a/studio_small_08"
  };
  fs.writeFileSync(path.join(ENV_DIR, "generic-indoor-studio.json"), JSON.stringify(indoorGeneric, null, 2));

  // 3. Captured HDRI (nicer outdoor): "spruit_sunrise"
  const capturedUrl = await fetchAndUpload("https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/spruit_sunrise.jpg", "spruit_sunrise.jpg", "image/jpeg");
  const capturedHDRI = {
    id: "captured-spruit-sunrise",
    tier: "hdri",
    label: "Golden Sunrise",
    backdrop: {
      kind: "hdri",
      url: capturedUrl
    },
    allowedWeather: ["clear", "fog", "overcast"],
    defaultTimeOfDay: "morning",
    license: "CC0",
    source: "Poly Haven",
    sourceUrl: "https://polyhaven.com/a/spruit_sunrise"
  };
  fs.writeFileSync(path.join(ENV_DIR, "captured-spruit-sunrise.json"), JSON.stringify(capturedHDRI, null, 2));

  console.log("All environments imported successfully.");
}

main().catch(err => {
  console.error("Import failed:", err);
  process.exit(1);
});
