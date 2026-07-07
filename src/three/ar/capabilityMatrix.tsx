/**
 * src/three/ar/capabilityMatrix.tsx — AR_PET_SIM_SPEC §6 / AR9
 * Capability-detect test page: shows which AR features are available on this
 * device and the fallback each triggers. Pure logic lives in ./capabilities.
 */

import { detectCapabilities, degradationPlan } from "./capabilities";

export type { CapabilityReport } from "./capabilities";
export { detectCapabilities, degradationPlan } from "./capabilities";

export default function CapabilityMatrix() {
  const report = detectCapabilities();
  const plan = degradationPlan(report);
  const rows: [string, string][] = [
    ["WebXR", report.webxr ? "yes" : "no"],
    ["WebXR depth", report.webxrDepth ? "yes" : "no"],
    ["WebXR lighting", report.webxrLighting ? "yes" : "no"],
    ["Web Speech", report.webSpeech ? "yes" : "no"],
    ["8th Wall (XR8)", report.xr8 ? "yes" : "no"],
    ["→ tracking", plan.tracking],
    ["→ occlusion", plan.occlusion],
    ["→ lighting", plan.lighting],
    ["→ voice", plan.voice],
  ];
  return (
    <div className="p-4 text-sm">
      <h2 className="font-bold mb-2">AR capability matrix</h2>
      <table className="w-full">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-1 pr-4 opacity-70">{k}</td>
              <td className="py-1 font-mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
