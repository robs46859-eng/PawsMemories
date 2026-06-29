/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY_BROWSER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Google <model-viewer> web component (loaded via CDN in index.html).
// Declare it so TSX/React accepts the custom element. React 19 resolves
// intrinsic elements via the global JSX namespace, so wrap in `declare global`.
import type React from "react";

type ModelViewerAttributes = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement> & {
    src?: string;
    alt?: string;
    ar?: boolean;
    "auto-rotate"?: boolean;
    "camera-controls"?: boolean;
    "shadow-intensity"?: string | number;
    "ar-modes"?: string;
    poster?: string;
    loading?: string;
    exposure?: string | number;
  },
  HTMLElement
>;

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerAttributes;
    }
  }
}
