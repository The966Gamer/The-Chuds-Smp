import React from "react";
import { api, ApiError } from "./api";

export interface VerificationModalState {
  url: string;
  message?: string;
  action: "start" | "stop" | "restart";
}

export function useServerPower(onSuccess?: () => void) {
  const [busySignal, setBusySignal] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [verification, setVerification] = React.useState<VerificationModalState | null>(null);
  const [verifyBusy, setVerifyBusy] = React.useState(false);

  const power = React.useCallback(
    async (signal: "start" | "stop" | "restart") => {
      setBusySignal(signal);
      setError(null);
      try {
        await api.post("/api/power", { signal });
        if (onSuccess) onSuccess();
      } catch (err) {
        if (err instanceof ApiError && err.actionUrl) {
          setVerification({
            url: err.actionUrl,
            message: err.message,
            action: signal,
          });
        } else {
          setError(err instanceof Error ? err.message : "Failed to execute server command");
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
      await api.post("/api/power", { signal: verification.action });
      setVerification(null);
      if (onSuccess) onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.actionUrl) {
        setVerification((v) => (v ? { ...v, url: err.actionUrl! } : null));
      } else {
        setError(err instanceof Error ? err.message : "Verification retry failed");
        setVerification(null);
      }
    } finally {
      setVerifyBusy(false);
    }
  }, [verification, onSuccess]);

  const dismissVerification = React.useCallback(() => {
    setVerification(null);
  }, []);

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
