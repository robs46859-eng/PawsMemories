import React from "react";

/**
 * Cold-Storage "Warehouse" placeholder shown when DEPLOY_TARGET=warehouse
 * (i.e. on mypets.cc). The full warehouse (view/manage cold-stored models,
 * copy their GLB URLs for the animator) is a future phase — see
 * docs/PHASE9_MODEL_CAP_AND_WAREHOUSE_PLAN.md §9b. This just gives mypets.cc a
 * distinct identity now instead of running the full pawsome3d app.
 */
export default function WarehouseMode({ isDarkMode }: { isDarkMode?: boolean }) {
  return (
    <div className={`min-h-screen flex items-center justify-center p-6 ${isDarkMode ? "dark" : ""}`}>
      <div className="max-w-md w-full text-center bg-surface-container-high/80 backdrop-blur border border-outline-variant/40 rounded-3xl p-8 shadow-xl">
        <div className="text-5xl mb-4">📦</div>
        <h1 className="text-2xl font-extrabold text-primary tracking-tight mb-2">
          Cold Storage Warehouse
        </h1>
        <p className="text-sm text-on-surface-variant mb-6">
          This is where your archived Pawsome3D models will live — view them, manage
          them, and copy their model links to use in the Animator.
        </p>
        <div className="text-xs font-bold uppercase tracking-wider text-secondary bg-secondary-container/40 rounded-full px-4 py-2 inline-block">
          Coming soon
        </div>
        <p className="text-[11px] text-on-surface-variant/70 mt-6">
          Create and manage active models at{" "}
          <a href="https://pawsome3d.com" className="text-primary font-semibold underline">
            pawsome3d.com
          </a>
        </p>
      </div>
    </div>
  );
}
