"use client";

import React from "react";
import { api, ApiError } from "./api";

export type PowerSignal = "start" | "stop" | "restart";

export interface Verification {
  /** Falix-provided https URL hosting the verification challenge. */
  url: string;
  /** The power signal to re-send once the user completes the challenge. */
  signal: PowerSignal;
}

const STARTING_STATES = new Set(["starting", "running", "booting", "launching", "pending"]);

/**
 * Single owner of server power-action UI state: which signal is in flight,
 * the last error, and the Falix free-plan verification flow (a challenge URL
 * the user must complete before Falix honors a start).
 *
 * Flow: power("start") → 409 with action_url → dialog opens → user solves the
 * captcha → Falix auto-starts the server → the status watcher sees the server
 * leave its stopped state and closes the dialog. If Falix never auto-starts,
 * the dialog's "Start server" button re-sends the signal as a fallback.
 */
export function useServerPower(onSuccess?: () => void) {
  const [busySignal, setBusySignal] = React.useState<PowerSignal | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [verification, setVerification] = React.useState<Verification | null>(null);
  const [verifyBusy, setVerifyBusy] = React.useState(false);

  const extractChallenge = (e: unknown): string | undefined => {
    const url = e instanceof ApiError ? e.actionUrl : (e as { actionUrl?: string })?.actionUrl;
    return typeof url === "string" && url.startsWith("https://") ? url : undefined;
  };

  const power = React.useCallback(
    async (signal: PowerSignal) => {
      setBusySignal(signal);
      setError(null);
      try {
        await api.post("/api/server/power", { signal });
        onSuccess?.();
      } catch (e) {
        // A verification challenge opens the dialog INSTEAD of showing an
        // error — the user's next step is the captcha, not an error message.
        const url = extractChallenge(e);
        if (url) {
          setError(null);
          setVerification({ url, signal });
        } else {
          setError(e instanceof Error ? e.message : "Action failed");
        }
      } finally {
        setBusySignal(null);
      }
    },
    [onSuccess],
  );

  const retryVerification = React.useCallback(async () => {
    if (!verification) return;
    setVerifyBusy(true);
    try {
      await api.post("/api/server/power", { signal: verification.signal });
      setVerification(null);
      onSuccess?.();
    } catch (e) {
      const url = extractChallenge(e);
      if (url) {
        // Challenge not finished yet (or a fresh link arrived): swap the URL
        // quietly — the dialog stays open on the captcha, no error text.
        setVerification({ url, signal: verification.signal });
      } else {
        // Not a challenge (e.g. Falix is already booting): close the dialog,
        // refresh status, and surface any real message in the controls widget.
        setVerification(null);
        setError(e instanceof Error ? e.message : "Action failed");
        onSuccess?.();
      }
    } finally {
      setVerifyBusy(false);
    }
  }, [verification, onSuccess]);

  const dismissVerification = React.useCallback(() => {
    setVerification(null);
  }, []);

  /**
   * Auto-close watcher. Falix auto-starts the server once the captcha is
   * solved, so while the dialog is open we watch server status: any signal
   * that the server is no longer sitting fully stopped closes the dialog —
   * "starting"/"running" but also "booting"/"launching"/"pending" variants.
   * As a belt-and-braces escape hatch (status API erroring, unknown string),
   * a graceful fallback: if the status endpoint consistently errors we close
   * after 90s so the user is never stuck staring at the captcha.
   */
  React.useEffect(() => {
    if (!verification) return;
    let cancelled = false;
    let failures = 0;
    const openedAt = Date.now();
    const check = async () => {
      try {
        const s = await api.get<{ falix?: { status?: string }; minecraft?: { online?: boolean } | null }>(
          "/api/status",
        );
        if (cancelled) return;
        failures = 0;
        const st = (s.falix?.status ?? "").toLowerCase();
        const mcOnline = s.minecraft?.online === true;
        if (STARTING_STATES.has(st) || mcOnline) {
          setVerification(null);
          onSuccess?.();
        } else if (Date.now() - openedAt > 90_000 && ++failures >= 3) {
          // Status has answered but the server is still fully stopped after
          // 90s — close so the user can act (they can press Start again).
          setVerification(null);
        }
      } catch {
        // Transient error — keep polling; a persistent failure eventually
        // triggers the 90s escape hatch above.
        if (!cancelled && ++failures >= 3 && Date.now() - openedAt > 90_000) {
          setVerification(null);
        }
      }
    };
    const t = setInterval(check, 4000);
    void check();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [verification, onSuccess]);

  return {
    busySignal,
    error,
    verification,
    verifyBusy,
    power,
    retryVerification,
    dismissVerification,
  };
}
