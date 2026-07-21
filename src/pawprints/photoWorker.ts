interface ScaleRequest {
  id: string;
  file: File;
  maxEdge: number;
  maxPixels: number;
  quality: number;
}

self.onmessage = async (event: MessageEvent<ScaleRequest>) => {
  const { id, file, maxEdge, maxPixels, quality } = event.data;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (bitmap.width < 600 || bitmap.height < 600) throw new Error(`${file.name}: minimum size is 600 × 600 pixels.`);
    const edgeScale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const pixelScale = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
    const scale = Math.min(edgeScale, pixelScale);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Photo scaling is unavailable.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    let blob: Blob;
    try {
      blob = await canvas.convertToBlob({ type: "image/webp", quality });
    } catch {
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    }
    const buffer = await blob.arrayBuffer();
    self.postMessage({ id, ok: true, width, height, mimeType: blob.type, buffer }, { transfer: [buffer] });
  } catch (error: any) {
    self.postMessage({ id, ok: false, error: error?.message || "The photo could not be prepared." });
  } finally {
    bitmap?.close();
  }
};

export {};
