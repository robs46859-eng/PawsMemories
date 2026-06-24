import React from "react";

interface PetModelViewerProps {
  /** Public URL of the GLB model (Backblaze-hosted Meshy output). */
  src: string;
  /** Optional still image used as a loading poster. */
  poster?: string;
  alt?: string;
  className?: string;
}

/**
 * Renders a Meshy-generated 3D pet model using Google's <model-viewer> web
 * component (loaded via CDN in index.html). Provides orbit controls, auto
 * rotation, and AR ("View in your space") on supporting mobile devices.
 */
const PetModelViewer: React.FC<PetModelViewerProps> = ({
  src,
  poster,
  alt = "3D model of your pet",
  className = "",
}) => {
  return (
    // @ts-expect-error - Custom web component loaded via CDN
    <model-viewer
      src={src}
      poster={poster}
      alt={alt}
      camera-controls
      auto-rotate
      ar
      ar-modes="webxr scene-viewer quick-look"
      shadow-intensity="1"
      exposure="1"
      loading="eager"
      className={className}
      style={{ width: "100%", height: "100%", minHeight: "320px", background: "transparent" }}
    />
  );
};

export default PetModelViewer;
