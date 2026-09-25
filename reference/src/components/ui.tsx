"use client";

import React from "react";

export function McHead({
  username,
  headUrl,
  size = 32,
}: {
  username: string;
  headUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = React.useState(false);
  const src = headUrl ?? `https://mc-heads.net/avatar/${encodeURIComponent(username)}/${size * 2}`;
  if (failed) {
    return (
      <div
        className="mc-head"
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.5,
          color: "var(--text-dim)",
        }}
        title="Head data not found. Please log into the Minecraft server once, then refresh."
      >
        ?
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mc-head"
      src={src}
      width={size}
      height={size}
      alt={`${username} head`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function StatusBadge({ status }: { status: "online" | "offline" | "starting" | "stopping" | "unknown" }) {
  const map = {
    online: { cls: "green", label: "Online" },
    offline: { cls: "red", label: "Offline" },
    starting: { cls: "amber", label: "Starting" },
    stopping: { cls: "amber", label: "Stopping" },
    unknown: { cls: "gray", label: "Unknown" },
  } as const;
  const m = map[status] ?? map.unknown;
  return (
    <span className={`badge ${m.cls}`}>
      <span className={`dot ${m.cls}`} style={{ width: 6, height: 6 }} />
      {m.label}
    </span>
  );
}

import { PixelIconView, type IconName } from "./icons";

export function EmptyState({
  icon = "pickaxe" as IconName,
  title,
  hint,
  children,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <PixelIconView name={icon} size={34} style={{ opacity: 0.7 }} />
      <div className="title">{title}</div>
      {hint ? <div className="hint">{hint}</div> : null}
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <div style={{ fontWeight: 600 }}>Something went wrong</div>
      <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{message}</div>
      {onRetry ? (
        <button className="btn sm" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonRows({ rows = 4, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyStyle,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyStyle?: React.CSSProperties;
}) {
  return (
    <div className={`panel ${className ?? ""}`}>
      {title || actions ? (
        <div className="panel-header">
          <div className="panel-title">{title}</div>
          {actions ? <div style={{ display: "flex", gap: 8 }}>{actions}</div> : null}
        </div>
      ) : null}
      <div className="panel-body" style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}
