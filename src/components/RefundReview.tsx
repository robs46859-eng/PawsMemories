import React, { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { authedFetch } from "../api";

const reasons = [
  ["a_style", "The style does not match what I asked for."],
  ["b_anatomy", "The body or anatomy looks wrong."],
  ["c_uncanny", "It feels uncanny or too realistic."],
  ["d_prompt", "It missed important details from my request."],
  ["e_other", "Something else is wrong."],
] as const;

export default function RefundReview({ avatarId, onClose }: { avatarId?: number; onClose: () => void }) {
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState("");

  const startReview = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await authedFetch("/api/refunds/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not review this model.");
      setReviewId(data.reviewId);
      setScore(data.matchScore);
      if (data.matchScore <= 55) setOutcome("This looks eligible for an automatic review path. Pick the closest reason below.");
    } catch (err: any) {
      setError(err.message || "Could not review this model.");
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (reasonCode: string) => {
    if (!reviewId) return;
    setBusy(true);
    try {
      const res = await authedFetch("/api/refunds/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, reasonCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not finish review.");
      setOutcome(data.status === "approved" ? "Approved. Credits were returned." : data.status === "free_retry" ? "Free retry noted. Use the lighter styling option next." : "Sent for manual review.");
    } catch (err: any) {
      setError(err.message || "Could not finish review.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] bg-black/70 flex items-center justify-center p-4">
      <section className="w-full max-w-xl rounded-2xl bg-surface text-on-surface border border-outline-variant shadow-2xl p-6">
        <h2 className="text-2xl font-black mb-2">AI is reviewing</h2>
        <p className="text-base text-on-surface-variant mb-4">We compare your request to the output. The AI cannot choose credit amounts.</p>
        {!reviewId && (
          <button onClick={startReview} disabled={busy} className="w-full min-h-14 rounded-xl bg-primary text-on-primary text-lg font-black flex items-center justify-center gap-2">
            {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Start review
          </button>
        )}
        {score !== null && <div className="my-4 text-4xl font-black text-primary">{score}/100</div>}
        {reviewId && (
          <div className="grid gap-2">
            {reasons.map(([code, label]) => (
              <button key={code} onClick={() => resolve(code)} disabled={busy} className="min-h-12 rounded-xl border border-outline-variant px-4 text-left text-base font-bold">
                {label}
              </button>
            ))}
          </div>
        )}
        {outcome && <p className="mt-4 text-sm font-bold text-primary">{outcome}</p>}
        {error && <p className="mt-4 text-sm font-bold text-error">{error}</p>}
        <button onClick={onClose} className="mt-5 w-full min-h-12 rounded-xl border border-outline-variant text-base font-black">Close</button>
      </section>
    </div>
  );
}
