import React, { useState } from "react";
import { X, Send, Loader2, Mail } from "lucide-react";

interface HelpModalProps {
  userEmail: string;
  onClose: () => void;
}

export default function HelpModal({ userEmail, onClose }: HelpModalProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; mailto?: string; text: string } | null>(null);

  const handleSubmit = async () => {
    if (message.trim().length < 10) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("paws_auth_token")}` },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await res.json();
      if (data.mailto) {
        window.open(data.mailto, "_blank");
        setResult({ success: true, text: data.message || "Opening your email client..." });
      } else if (data.success) {
        setResult({ success: true, text: data.message || "Sent! We'll get back to you soon." });
      } else {
        setResult({ success: false, text: data.error || "Could not send. Please try again." });
      }
    } catch {
      setResult({ success: false, text: "Network error. Please try again." });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl border border-outline-variant/30 text-on-surface">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold text-primary flex items-center gap-2">
            <Mail size={18} /> Help & Support
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-surface-variant/50 flex items-center justify-center cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
          Describe your issue below. We'll get back to you at <strong>{userEmail}</strong>.
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe what you need help with..."
          className="w-full h-28 p-3 rounded-xl border border-outline-variant/30 bg-surface-container resize-none text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          disabled={sending}
        />
        <div className="flex items-center justify-between mt-3">
          <span className={`text-[10px] ${message.trim().length < 10 ? "text-error" : "text-on-surface-variant"}`}>
            {message.trim().length}/10 min
          </span>
          <button
            onClick={handleSubmit}
            disabled={sending || message.trim().length < 10}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary rounded-xl text-xs font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </div>
        {result && (
          <div className={`mt-3 p-3 rounded-xl text-xs font-medium ${result.success ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-error/10 text-error"}`}>
            {result.text}
          </div>
        )}
      </div>
    </div>
  );
}