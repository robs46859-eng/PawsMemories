import * as Mp4Muxer from "mp4-muxer";
import { RecordingConfig } from "./capabilities";

export interface EncoderLifecycle {
  start(): void;
  addFrame(videoFrame: VideoFrame): void;
  finish(): Promise<Blob>;
}

export function createMp4Encoder(config: RecordingConfig): EncoderLifecycle {
  let muxer: Mp4Muxer.Muxer<Mp4Muxer.ArrayBufferTarget>;
  let videoEncoder: VideoEncoder;
  
  const init = () => {
    muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: {
        codec: config.codec.startsWith('avc') ? 'avc' : 'vp9',
        width: config.width,
        height: config.height
      },
      fastStart: "in-memory"
    });

    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (muxer) {
          muxer.addVideoChunk(chunk, meta);
        }
      },
      error: (e) => {
        console.error("VideoEncoder error:", e);
      }
    });

    videoEncoder.configure({
      codec: config.codec,
      width: config.width,
      height: config.height,
      bitrate: config.bitrate,
      framerate: config.fps,
      // avc: { format: 'annexb' } // needed for mp4-muxer? Actually mp4-muxer handles avc just fine.
    });
  };

  return {
    start() {
      init();
    },
    addFrame(frame: VideoFrame) {
      if (videoEncoder.state === "configured") {
        videoEncoder.encode(frame, { keyFrame: frame.timestamp === 0 });
      }
      frame.close();
    },
    async finish(): Promise<Blob> {
      if (videoEncoder) {
        await videoEncoder.flush();
        videoEncoder.close();
      }
      if (muxer) {
        muxer.finalize();
        const buffer = muxer.target.buffer;
        return new Blob([buffer], { type: 'video/mp4' });
      }
      throw new Error("Muxer not initialized");
    }
  };
}
