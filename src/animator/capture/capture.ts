export async function captureScreenshot(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create blob from canvas"));
        }
      }, 'image/png');
    } catch (e) {
      reject(e);
    }
  });
}

// Optional helper to grab a single frame from the canvas and wrap it in a VideoFrame
export function captureVideoFrame(canvas: HTMLCanvasElement, timestampMicros: number): VideoFrame {
  // Uses the WebCodecs VideoFrame constructor.
  // We need to ensure the canvas is drawn to before capturing.
  // Often with webgl we might need to preserveDrawingBuffer: true, or grab it immediately after render.
  return new VideoFrame(canvas, { timestamp: timestampMicros });
}
