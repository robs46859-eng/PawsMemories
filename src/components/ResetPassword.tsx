import React, { useState } from "react";
import { resetPassword } from "../api";

/**
 * Standalone password-reset page, shown when the app is opened at
 * /reset-password?token=... (from the emailed reset link). Not part of the
 * Screen-enum flow — App.tsx renders this before auth when the path matches.
 */
export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const goToLogin = () => {
    window.history.replaceState({}, document.title, "/");
    window.location.href = "/";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) { setError("This reset link is missing its token. Please use the link from your email."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "Could not reset your password. Please request a new link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-surface">
      <div className="w-full max-w-sm bg-surface-container-high border border-outline-variant/40 rounded-2xl p-6 shadow-sm">
        <h1 className="text-xl font-extrabold text-on-surface mb-1">Reset your password</h1>
        {done ? (
          <>
            <p className="text-sm text-on-surface-variant mb-6">Your password has been updated. You can now sign in with your new password.</p>
            <button onClick={goToLogin} className="w-full py-3 rounded-full bg-primary text-on-primary font-bold active:scale-95 transition-all">
              Go to sign in
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-on-surface-variant mb-2">Choose a new password for your Pawsome3D account.</p>
            <input
              type="password" autoFocus placeholder="New password (min 8 characters)"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface border border-outline-variant/50 text-on-surface"
            />
            <input
              type="password" placeholder="Confirm new password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface border border-outline-variant/50 text-on-surface"
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={busy}
              className="w-full py-3 rounded-full bg-primary text-on-primary font-bold active:scale-95 transition-all disabled:opacity-60">
              {busy ? "Updating…" : "Update password"}
            </button>
            <button type="button" onClick={goToLogin} className="w-full text-sm text-on-surface-variant hover:text-primary">
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
