import React from "react";

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
  return (
    // @ts-expect-error - Custom web component loaded via CDN
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
