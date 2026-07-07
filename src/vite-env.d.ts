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

  // --------------------------------------------------------------------------
  // WebXR AR type stubs (Phases 3–5)
  //
  // These APIs exist at runtime in Chrome on ARCore devices but are not shipped
  // in lib.dom.d.ts or @types/webxr. Declaring them here avoids `any` casts
  // throughout the AR modules.
  // --------------------------------------------------------------------------

  /** An anchor attached to a real-world surface (Phase 2). */
  interface XRAnchor {
    readonly anchorSpace: XRSpace;
    delete(): void;
  }

  /** A detected real-world surface (Phase 3). */
  interface XRPlane {
    readonly planeSpace: XRSpace;
    readonly polygon: DOMPointReadOnly[];
    readonly orientation: "horizontal" | "vertical";
    readonly lastChangedTime: number;
  }

  /** Result of a hit-test ray against real surfaces. */
  interface XRHitTestResult {
    getPose(baseSpace: XRSpace): XRPose | null;
    createAnchor?(): Promise<XRAnchor>;
  }

  /** Type of trackable for hit-test sources. */
  type XRHitTestTrackableType = "point" | "plane" | "mesh";

  /** Light probe handle (Phase 5). */
  interface XRLightProbe extends EventTarget {
    readonly probeSpace: XRSpace;
  }

  /** Per-frame light estimate (Phase 5). */
  interface XRLightEstimate {
    readonly sphericalHarmonicsCoefficients: Float32Array;
    readonly primaryLightDirection: DOMPointReadOnly;
    readonly primaryLightIntensity: DOMPointReadOnly;
  }

  /** GPU depth information for a single view (Phase 4). */
  interface XRDepthInformation {
    readonly width: number;
    readonly height: number;
    readonly rawValueToMeters: number;
    readonly normDepthBufferFromNormView: XRRigidTransform;
  }

  /** GPU-optimized depth information with a native texture handle. */
  interface XRWebGLDepthInformation extends XRDepthInformation {
    readonly texture: WebGLTexture;
  }

  /** Binding between an XR session and a WebGL context (Phases 4 & 5). */
  interface XRWebGLBinding {
    getDepthInformation(view: XRView): XRWebGLDepthInformation | null;
    getReflectionCubeMap(lightProbe: XRLightProbe): WebGLTexture | null;
  }

  // Extend the built-in XRFrame with optional AR properties.
  interface XRFrame {
    readonly detectedPlanes?: Set<XRPlane>;
    getLightEstimate?(lightProbe: XRLightProbe): XRLightEstimate | null;
  }

  // Extend XRSession with light probe support.
  interface XRSession {
    requestLightProbe?(options?: { reflectionFormat?: string }): Promise<XRLightProbe>;
  }

  // Constructor for XRWebGLBinding.
  var XRWebGLBinding: {
    new (session: XRSession, context: WebGLRenderingContext | WebGL2RenderingContext): XRWebGLBinding;
  };
}

