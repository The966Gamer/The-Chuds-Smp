"use client";

import React from "react";

/**
 * Hand-drawn pixel-art icon set (16×16 grid, crispEdges) in Minecraft item
 * palettes. Pure SVG — no emoji, no image downloads, sharp at any size.
 * Each icon is a list of rects: [x, y, w, h, color].
 */

type Rect = [number, number, number, number, string];

const P = {
  grass: "#7CBD45",
  grassDark: "#5F9E33",
  grassDeep: "#4F8322",
  dirt: "#7A5537",
  dirtDark: "#6B4A2E",
  dirtLight: "#8A6240",
  stone: "#8F8F8F",
  stoneDark: "#5E5E5E",
  wood: "#9C7141",
  woodDark: "#6B4A2E",
  iron: "#D8D8D8",
  red: "#E0564F",
  redDark: "#A83A35",
  cyan: "#4F9FD8",
  cyanDark: "#2D6B96",
  purple: "#8B5CF6",
  paper: "#E8DCC0",
  amber: "#E0A83C",
  white: "#F4F7F0",
  black: "#101408",
  eye: "#101408",
};

function PixelIcon({ rects, size, className, style }: { rects: Rect[]; size: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={className}
      style={{ display: "block", flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {rects.map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} />
      ))}
    </svg>
  );
}

/* ---------------------------------- grass block (isometric-ish) ---------------------------------- */
const GRASS_BLOCK: Rect[] = [
  // dirt body
  [2, 5, 12, 9, P.dirt],
  [2, 5, 3, 3, P.dirtDark],
  [11, 8, 3, 3, P.dirtLight],
  [5, 10, 4, 3, P.dirtDark],
  // grass canopy
  [2, 3, 12, 2, P.grass],
  [2, 2, 4, 1, P.grassDark],
  [7, 2, 3, 1, P.grassDark],
  [12, 3, 2, 1, P.grassDeep],
  [3, 5, 2, 1, P.grassDark],
  [8, 5, 2, 1, P.grassDark],
  [13, 5, 1, 1, P.grassDark],
];

/* ------------------------------------ pickaxe (iron + wood) ------------------------------------ */
const PICKAXE: Rect[] = [
  [3, 2, 10, 2, P.iron],
  [2, 3, 2, 2, P.iron],
  [12, 3, 2, 2, P.iron],
  [1, 5, 2, 1, P.stoneDark],
  [13, 5, 2, 1, P.stoneDark],
  [7, 4, 2, 3, P.wood],
  [6, 7, 4, 2, P.wood],
  [7, 9, 2, 5, P.woodDark],
];

/* ------------------------------------ terminal / console ------------------------------------ */
const CONSOLE: Rect[] = [
  [1, 2, 14, 12, P.stone],
  [1, 2, 14, 2, P.stoneDark],
  [3, 6, 7, 1, P.grass],
  [3, 8, 9, 1, P.paper],
  [3, 10, 5, 1, P.paper],
  [12, 10, 2, 1, P.amber],
  [3, 12, 3, 1, P.cyan],
];

/* ------------------------------------ players ------------------------------------ */
const PLAYERS: Rect[] = [
  [2, 2, 5, 5, P.dirtLight],
  [3, 4, 1, 1, P.eye],
  [5, 4, 1, 1, P.eye],
  [3, 6, 3, 1, P.dirtDark],
  [9, 3, 5, 6, P.grass],
  [10, 5, 1, 1, P.eye],
  [12, 5, 1, 1, P.eye],
  [10, 7, 3, 1, P.grassDeep],
  [3, 9, 3, 5, P.cyan],
  [10, 10, 3, 4, P.red],
];

/* ------------------------------------ grave / skull ------------------------------------ */
const GRAVE: Rect[] = [
  [5, 2, 6, 9, P.stone],
  [5, 2, 6, 2, P.stoneDark],
  [7, 5, 2, 4, P.stoneDark],
  [4, 11, 8, 3, P.dirt],
  [4, 11, 8, 1, P.grass],
];

/* ------------------------------------ chat bubble ------------------------------------ */
const CHAT: Rect[] = [
  [2, 3, 12, 8, P.paper],
  [2, 3, 12, 1, P.white],
  [2, 10, 12, 1, "#C9BC97"],
  [4, 6, 8, 1, P.stoneDark],
  [4, 8, 5, 1, P.stoneDark],
  [5, 11, 3, 3, P.paper],
  [5, 11, 3, 1, "#C9BC97"],
];

/* ------------------------------------ scroll / activity ------------------------------------ */
const SCROLL: Rect[] = [
  [3, 2, 10, 12, P.paper],
  [3, 2, 10, 1, P.white],
  [3, 13, 10, 1, "#C9BC97"],
  [2, 4, 1, 8, "#C9BC97"],
  [13, 4, 1, 8, "#C9BC97"],
  [5, 5, 6, 1, P.stoneDark],
  [5, 7, 4, 1, P.stoneDark],
  [5, 9, 7, 1, P.grassDark],
  [5, 11, 3, 1, P.stoneDark],
];

/* ------------------------------------ statistics chart ------------------------------------ */
const CHART: Rect[] = [
  [2, 13, 12, 1, P.stoneDark],
  [2, 3, 1, 10, P.stoneDark],
  [4, 9, 2, 4, P.grass],
  [7, 6, 2, 7, P.grassDark],
  [10, 4, 2, 9, P.grass],
  [13, 7, 1, 6, P.cyan],
];

/* ------------------------------------ discord ------------------------------------ */
const DISCORD: Rect[] = [
  [2, 4, 12, 8, P.purple],
  [2, 4, 12, 1, "#A78BFA"],
  [4, 7, 2, 2, P.white],
  [10, 7, 2, 2, P.white],
  [6, 10, 4, 1, P.white],
  [1, 6, 1, 4, "#6D28D9"],
  [14, 6, 1, 4, "#6D28D9"],
];

/* ------------------------------------ settings gear ------------------------------------ */
const GEAR: Rect[] = [
  [6, 2, 4, 2, P.stone],
  [6, 12, 4, 2, P.stone],
  [2, 6, 2, 4, P.stone],
  [12, 6, 2, 4, P.stone],
  [4, 4, 8, 8, P.stone],
  [6, 6, 4, 4, P.stoneDark],
  [4, 4, 2, 2, P.stoneDark],
  [10, 4, 2, 2, P.stoneDark],
  [4, 10, 2, 2, P.stoneDark],
  [10, 10, 2, 2, P.stoneDark],
];

/* ------------------------------------ creeper face ------------------------------------ */
const CREEPER: Rect[] = [
  [1, 1, 14, 14, P.grass],
  [1, 1, 14, 1, P.grassDark],
  [3, 4, 3, 3, P.black],
  [10, 4, 3, 3, P.black],
  [6, 7, 4, 3, P.black],
  [5, 9, 2, 4, P.black],
  [9, 9, 2, 4, P.black],
];

/* ------------------------------------ heart ------------------------------------ */
const HEART: Rect[] = [
  [3, 3, 4, 2, P.red],
  [9, 3, 4, 2, P.red],
  [2, 5, 12, 3, P.red],
  [3, 8, 10, 2, P.red],
  [5, 10, 6, 2, P.redDark],
  [7, 12, 2, 1, P.redDark],
  [4, 4, 2, 1, "#F08A85"],
];

/* ------------------------------------ shield ------------------------------------ */
const SHIELD: Rect[] = [
  [3, 2, 10, 8, P.cyan],
  [3, 2, 10, 1, "#7DB9E8"],
  [2, 4, 12, 4, P.cyan],
  [4, 10, 8, 2, P.cyanDark],
  [6, 12, 4, 2, P.cyanDark],
  [7, 4, 2, 6, P.white],
];

/* ------------------------------------ bell ------------------------------------ */
const BELL: Rect[] = [
  [4, 3, 8, 7, P.amber],
  [4, 3, 8, 1, "#F0C46A"],
  [3, 10, 10, 2, P.amber],
  [7, 12, 2, 2, P.amber],
  [7, 1, 2, 2, P.woodDark],
];

/* ------------------------------------ export ---------------------------------- */
const ICONS: Record<string, Rect[]> = {
  dashboard: GRASS_BLOCK,
  console: CONSOLE,
  players: PLAYERS,
  graves: GRAVE,
  chat: CHAT,
  activity: SCROLL,
  statistics: CHART,
  discord: DISCORD,
  settings: GEAR,
  creeper: CREEPER,
  heart: HEART,
  shield: SHIELD,
  bell: BELL,
  pickaxe: PICKAXE,
};

export type IconName = keyof typeof ICONS;

export function PixelIconView({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: React.CSSProperties }) {
  const rects = ICONS[name];
  if (!rects) return null;
  return <PixelIcon rects={rects} size={size} className={className} style={style} />;
}

/** Brand mark: grass block + subtle bevel, used in the sidebar and heroes. */
export function PanelMark({ size = 34 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        background: "rgba(124, 189, 69, 0.12)",
        border: "1px solid rgba(124, 189, 69, 0.45)",
        borderRadius: 4,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    >
      <PixelIconView name="pickaxe" size={size - 14} />
    </div>
  );
}
