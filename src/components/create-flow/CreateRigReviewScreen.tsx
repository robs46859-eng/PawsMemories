import React, { useState } from "react";
import { useCreateFlow } from "./CreateFlowContext";
import { acceptRigJob } from "../../api";
import { Screen } from "../../types";

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const CreateRigReviewScreen: React.FC<Props> = ({ onNavigate }) => {
  const { rigJob, setRigJob } = useCreateFlow();
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!rigJob) {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-slate-900 text-white rounded-xl my-8 text-center">
        <p className="text-slate-400">No active rig job found.</p>
        <button onClick={() => onNavigate(Screen.CREATE)} className="mt-4 px-4 py-2 bg-emerald-600 rounded">
          Return to Creation
        </button>
      </div>
    );
  }

  const handleAccept = async () => {
    setIsAccepting(true);
    setError(null);
    try {
      if (!rigJob.manifestHash || !rigJob.rigValidation?.overallPass) {
        throw new Error("The measured rig validation manifest is incomplete or did not pass.");
      }
      const accepted = await acceptRigJob(rigJob.jobUuid, rigJob.manifestHash);
      setRigJob(accepted);
      onNavigate(Screen.FURBIN);
    } catch (err: any) {
      setError(err.message || "Failed to accept rig job");
    } finally {
      setIsAccepting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-800 my-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-emerald-400">Rigged Model & Facial Verification</h2>
          <p className="text-slate-400 text-sm">Review skeleton geometry, facial capability disclosure, and accessory fits.</p>
        </div>
        <span className="px-3 py-1 bg-emerald-950 text-emerald-300 border border-emerald-700 rounded-full text-xs font-mono">
          {rigJob.state.toUpperCase()}
        </span>
      </div>

      {error && (
        <div className="p-4 bg-rose-900/50 border border-rose-700 text-rose-200 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Skeleton & Kinematics Card */}
        <div className="bg-slate-800/80 p-5 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-cyan-300 mb-3">Skeleton & Rigging</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Classification:</span>
              <span className="font-mono capitalize text-white">{rigJob.classification || "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bone Count:</span>
              <span className="font-mono text-white">{rigJob.rigValidation?.boneCount ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Max Influences/Vertex:</span>
              <span className="font-mono text-white">{rigJob.rigValidation?.maxInfluences ?? 0} (Max 4)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Mobile Budget Pass:</span>
              <span className={`font-mono ${rigJob.rigValidation?.mobileBudgetPass ? "text-emerald-400" : "text-amber-400"}`}>
                {rigJob.rigValidation?.mobileBudgetPass ? "PASSED" : "FAILED"}
              </span>
            </div>
          </div>
        </div>

        {/* Facial Capability Disclosure Card */}
        <div className="bg-slate-800/80 p-5 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-cyan-300 mb-3">Facial Capability Inventory</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Measured Capability:</span>
              <span className="font-mono uppercase font-bold text-amber-300">
                {rigJob.facialCapability || "BODY_ONLY"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Viseme Coverage:</span>
              <span className="font-mono text-white">
                {Math.round((rigJob.facialInventory?.visemeCoverage ?? 0) * 100)}% (9 Canonical Shapes)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Blink & Jaw Controls:</span>
              <span className="font-mono text-white">
                {rigJob.facialInventory?.hasBlink ? "Blink ✓ " : "Blink ✗ "}
                {rigJob.facialInventory?.hasJaw ? "Jaw ✓" : "Jaw ✗"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Accessories Section */}
      {rigJob.accessories && rigJob.accessories.length > 0 && (
        <div className="bg-slate-800/80 p-5 rounded-lg border border-slate-700 mb-6">
          <h3 className="text-lg font-semibold text-cyan-300 mb-3">Attached Accessories</h3>
          <div className="space-y-2">
            {rigJob.accessories.map((acc: any, i: number) => (
              <div key={i} className="flex justify-between items-center p-2 bg-slate-900/60 rounded border border-slate-700 text-sm">
                <div>
                  <span className="font-medium text-white">{acc.accessoryName}</span>
                  <span className="text-slate-400 ml-2">({acc.attachmentBone})</span>
                </div>
                <span className="text-xs font-mono text-emerald-400">FITTED ✓</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex justify-between items-center pt-4 border-t border-slate-800">
        <button
          onClick={() => onNavigate(Screen.CREATE_BUILD_REVIEW)}
          className="px-4 py-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
        >
          Back
        </button>
        <button
          onClick={handleAccept}
          disabled={isAccepting || rigJob.state === "accepted" || !rigJob.manifestHash || !rigJob.rigValidation?.overallPass}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow-lg disabled:opacity-50"
        >
          {isAccepting ? "Accepting..." : rigJob.state === "accepted" ? "Accepted ✓" : "Accept Rig & Add to Fur Bin"}
        </button>
      </div>
    </div>
  );
};
