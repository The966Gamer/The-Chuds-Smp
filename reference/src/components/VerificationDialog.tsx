"use client";

import React from "react";
import type { Verification } from "@/lib/client/useServerPower";
import { PixelIconView } from "@/components/icons";

/**
 * Modal for the Falix free-plan verification challenge: embeds the challenge
 * URL (a captcha page) so the user never leaves the panel, with a new-tab
 * fallback for when Falix's headers block embedding. The parent owns the
 * verification state; this component is presentation only.
 *
 * Deliberately shows NO error text and no scary jargon: the only message is
 * "complete the captcha" — the Start button inside simply retries the start
 * signal once the check is done. Details stay in the panel console.
 */
export default function VerificationDialog({
  verification,
  busy,
  onRetry,
  onDismiss,
}: {
  verification: Verification;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Falix verification"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(4, 6, 3, 0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="panel mc-hero-block fade-in" style={{ width: "min(560px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div className="mc-hero-inner" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <PixelIconView name="shield" size={18} />
              <h2 style={{ fontSize: 13 }}>One quick check</h2>
            </div>
            <button className="btn sm ghost" aria-label="Close verification dialog" onClick={onDismiss}>
              ✕
            </button>
          </div>
          <p className="dim" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
            Falix needs you to prove you&apos;re human before starting a free server. Complete the captcha below — once
            it&apos;s done, press <strong>Start server</strong> and the server will boot. The link is valid for 5 minutes.
          </p>
          <div style={{ flex: 1, minHeight: 260, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-strong)", background: "#fff" }}>
            <iframe
              src={verification.url}
              title="Falix verification"
              style={{ width: "100%", height: "100%", minHeight: 260, border: "none" }}
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
            Box stays blank? Falix sometimes blocks embedding — use “Open in new tab ↗”, finish the check there, then come back and press Start server.
          </div>
          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={busy} onClick={onRetry}>
              {busy ? <span className="spinner" /> : "▶ Start server"}
            </button>
            <a className="btn sm" style={{ textDecoration: "none" }} href={verification.url} target="_blank" rel="noopener noreferrer">
              Open in new tab ↗
            </a>
            <button className="btn sm ghost" onClick={onDismiss}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
