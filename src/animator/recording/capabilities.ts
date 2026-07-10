export interface EncoderCapabilities {
  hasWebCodecs: boolean;
  supportedCodecs: string[];
  maxFps: number;
}

export interface RecordingConfig {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
}

export async function detectCapabilities(): Promise<EncoderCapabilities> {
  const hasWebCodecs = typeof window !== 'undefined' && 'VideoEncoder' in window;
  
  const capabilities: EncoderCapabilities = {
    hasWebCodecs,
    supportedCodecs: [],
    maxFps: 30, // Default fallback
  };

  if (!hasWebCodecs) {
    return capabilities;
  }

  const testCodecs = [
    'avc1.640028', // H.264 High
    'avc1.42E01F', // H.264 Baseline
    'vp8',
    'vp09.00.10.08' // VP9
  ];

  for (const codec of testCodecs) {
    try {
      const support = await (window as any).VideoEncoder.isConfigSupported({
        codec,
        width: 1280,
        height: 720,
        bitrate: 8_000_000,
        framerate: 30
      });
      if (support.supported) {
        capabilities.supportedCodecs.push(codec);
      }
    } catch (e) {
      // Ignore
    }
  }

  // Check 60fps support for High codec if available
  if (capabilities.supportedCodecs.includes('avc1.640028')) {
    try {
      const support = await (window as any).VideoEncoder.isConfigSupported({
        codec: 'avc1.640028',
        width: 1920,
        height: 1080,
        bitrate: 16_000_000,
        framerate: 60
      });
      if (support.supported) {
        capabilities.maxFps = 60;
      }
    } catch (e) {
      // Ignore
    }
  }

  return capabilities;
}

export function selectEncoder(capabilities: EncoderCapabilities): RecordingConfig | { unsupported: true, reason: string } {
  if (!capabilities.hasWebCodecs) {
    return { unsupported: true, reason: "WebCodecs API not supported in this browser." };
  }

  if (capabilities.supportedCodecs.includes('avc1.640028')) {
    return {
      width: 1920,
      height: 1080,
      fps: capabilities.maxFps === 60 ? 60 : 30,
      bitrate: 16_000_000, // 16 Mbps
      codec: 'avc1.640028'
    };
  } else if (capabilities.supportedCodecs.includes('avc1.42E01F')) {
    return {
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 8_000_000, // 8 Mbps
      codec: 'avc1.42E01F'
    };
  } else if (capabilities.supportedCodecs.includes('vp8') || capabilities.supportedCodecs.includes('vp09.00.10.08')) {
    const vpCodec = capabilities.supportedCodecs.includes('vp09.00.10.08') ? 'vp09.00.10.08' : 'vp8';
    return {
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 8_000_000,
      codec: vpCodec
    };
  }

  return { unsupported: true, reason: "No compatible H.264 or VP8/VP9 codec found." };
}
