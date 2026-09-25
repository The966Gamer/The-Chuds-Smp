import React from "react";
import { PixelIconView } from "./icons";

export interface VerificationInfo {
  url: string;
  message?: string;
}

export default function VerificationDialog({
  verification,
  busy,
  onRetry,
  onDismiss,
}: {
  verification: VerificationInfo;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4, 6, 10, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div className="panel mc-hero-block fade-in" style={{ width: "min(460px, 100%)", position: "relative" }}>
        <div className="mc-hero-inner" style={{ padding: "16px 24px 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ display: "grid", placeItems: "center", marginBottom: 10 }}>
              <PixelIconView name="creeper" size={44} className="bob" />
            </div>
            <h2 style={{ fontSize: 17, marginBottom: 6 }}>Falix Captcha Verification Required</h2>
            <p className="dim" style={{ fontSize: 13, margin: 0 }}>
              {verification.message || "Falix free tier requires captcha verification before booting the server."}
            </p>
          </div>

          <div
            className="panel mc-dirt-bed"
            style={{
              padding: 14,
              marginBottom: 16,
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--text-dim)",
            }}
          >
            <strong>To start the server:</strong><br />
            1. Open the verification link below in a new tab.<br />
            2. Complete the <strong>captcha</strong> on the Falix page.<br />
            3. Press the <strong>&quot;Start Server&quot;</strong> button on that Falix page.<br />
            4. Falix will boot up the server! Return here and click <strong>&quot;Check Server Status&quot;</strong>.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a
              href={verification.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn primary"
              style={{ textDecoration: "none", textAlign: "center", padding: "11px 16px" }}
            >
              Open Falix Captcha &amp; Press Start Server ↗
            </a>
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={onRetry}
              >
                {busy ? <span className="spinner" /> : "Check Server Status"}
              </button>
              <button className="btn ghost" disabled={busy} onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
