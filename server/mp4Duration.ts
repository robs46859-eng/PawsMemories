/**
 * Read an MP4 movie header (`mvhd`) without invoking ffprobe. Provider output
 * is already bounded before this runs; this parser only supplies duration
 * evidence for the job record and never attempts to decode media frames.
 */
export function readMp4DurationSeconds(buffer: Buffer): number | null {
  const marker = Buffer.from("mvhd", "ascii");
  let typeOffset = buffer.indexOf(marker);

  while (typeOffset >= 4) {
    const boxStart = typeOffset - 4;
    const boxSize = buffer.readUInt32BE(boxStart);
    const boxEnd = boxStart + boxSize;
    if (boxSize >= 32 && boxEnd <= buffer.length) {
      const version = buffer.readUInt8(typeOffset + 4);
      try {
        let timescale: number;
        let duration: number;
        if (version === 0) {
          timescale = buffer.readUInt32BE(typeOffset + 16);
          duration = buffer.readUInt32BE(typeOffset + 20);
        } else if (version === 1) {
          timescale = buffer.readUInt32BE(typeOffset + 24);
          const rawDuration = buffer.readBigUInt64BE(typeOffset + 28);
          if (rawDuration > BigInt(Number.MAX_SAFE_INTEGER)) return null;
          duration = Number(rawDuration);
        } else {
          return null;
        }
        if (timescale > 0 && duration > 0) return duration / timescale;
      } catch {
        return null;
      }
    }
    typeOffset = buffer.indexOf(marker, typeOffset + marker.length);
  }

  return null;
}
