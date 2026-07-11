import React, { useEffect, useState } from "react";

const MODEL_VIEWER_CDN =
  "https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js";

let modelViewerLoader: Promise<void> | null = null;

/**
 * Lazily load the <model-viewer> web component the first time any viewer mounts,
 * instead of a render-blocking CDN script in index.html on every page. Cached so
 * the script is only ever injected once per session.
 */
function ensureModelViewer(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).customElements?.get("model-viewer")) return Promise.resolve();
  if (modelViewerLoader) return modelViewerLoader;
  modelViewerLoader = new Promise<void>((resolve) => {
    const existing = document.querySelector(`script[src="${MODEL_VIEWER_CDN}"]`);
    if (existing) {
      customElements.whenDefined("model-viewer").then(() => resolve());
      return;
    }
    const s = document.createElement("script");
    s.type = "module";
    s.src = MODEL_VIEWER_CDN;
    s.onload = () => customElements.whenDefined("model-viewer").then(() => resolve());
    document.head.appendChild(s);
  });
  return modelViewerLoader;
}

interface PetModelViewerProps {
  /** Public URL of the GLB model. */
  src: string;
  /** Optional still image used as a loading poster. */
  poster?: string;
  alt?: string;
  className?: string;
  animationName?: string;
  animationCrossfade?: number;
  autoRotate?: boolean;
}

/**
 * Renders a 3D pet model using Google's <model-viewer> web component.
 */
const PetModelViewer: React.FC<PetModelViewerProps> = ({
  src,
  poster,
  alt = "3D model of your pet",
  className = "",
  animationName,
  animationCrossfade,
  autoRotate = true,
}) => {
  const [ready, setReady] = useState(
    typeof window !== "undefined" && !!(window as any).customElements?.get("model-viewer")
  );

  useEffect(() => {
    let active = true;
    ensureModelViewer().then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return (
      <div
        className={className}
        style={{ width: "100%", height: "100%", minHeight: "100%", background: "transparent" }}
        aria-busy="true"
      />
    );
  }

  return (
    // @ts-expect-error - Custom web component loaded on demand
    <model-viewer
      src={src}
      poster={poster}
      alt={alt}
      camera-controls={true}
      auto-rotate={autoRotate ? true : undefined}
      animation-name={animationName}
      animation-crossfade-duration={animationCrossfade !== undefined ? animationCrossfade : 300}
      autoplay={false}
      ar
      ar-modes="webxr scene-viewer quick-look"
      shadow-intensity="1"
      exposure="1"
      loading="eager"
      className={className}
      style={{ width: "100%", height: "100%", minHeight: "100%", background: "transparent" }}
    />
  );
};

export default PetModelViewer;
