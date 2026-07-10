export function createViewportSource(canvas: HTMLCanvasElement, fps: number): MediaStream {
  // Check if captureStream is available (it's non-standard but widely supported)
  const captureStream = (canvas as any).captureStream || (canvas as any).mozCaptureStream;
  if (!captureStream) {
    throw new Error("canvas.captureStream() is not supported in this browser");
  }
  return captureStream.call(canvas, fps);
}
