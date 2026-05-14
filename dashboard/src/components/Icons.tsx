/* Centralised SVG icon system for HoneyBee dashboard.
 *
 *  - `Icon` is the renderer for any icon path from `Icons`.
 *  - `Icons` exports every SVG path constant used across the app.
 *  - `PotIcon` returns the brand-style SVG for each honeypot type
 *    (replaces emojis with proper artwork).
 */

import type { CSSProperties, SVGProps } from "react";

/* ── Renderer ──────────────────────────────────── */
export const Icon = ({
  d,
  size = 18,
  color = "currentColor",
  sw = 2,
  style,
  ...rest
}: {
  d: string;
  size?: number;
  color?: string;
  sw?: number;
  style?: CSSProperties;
} & Omit<SVGProps<SVGSVGElement>, "color" | "style">) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
    {...rest}
  >
    <path d={d} />
  </svg>
);

/* ── Icon path catalogue ────────────────────────── */
export const Icons = {
  // Navigation
  dashboard:    "M3 12L12 3l9 9M5 10v10h14V10",
  nodes:        "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18",
  events:       "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
  potstore:     "M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4",
  users:        "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0",
  systemCheck:  "M9 12l2 2 4-4M12 22a10 10 0 110-20 10 10 0 010 20z",

  // Common
  refresh:      "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  logout:       "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  close:        "M18 6L6 18M6 6l12 12",
  check:        "M20 6L9 17l-5-5",
  arrow:        "M5 12h14M12 5l7 7-7 7",
  arrowDown:    "M12 5v14M19 12l-7 7-7-7",
  link:         "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  warn:         "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  shield:       "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  bolt:         "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
  search:       "M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z",
  plus:         "M12 5v14M5 12h14",
  trash:        "M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6",
  copy:         "M16 1H4a2 2 0 00-2 2v14h2V3h12V1zM20 5H8a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2z",
  clock:        "M12 8v4l3 3M12 22a10 10 0 110-20 10 10 0 010 20z",
  key:          "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  server:       "M5 12H3a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v4a2 2 0 01-2 2h-2M5 12v8a2 2 0 002 2h10a2 2 0 002-2v-8M5 12h14M9 7h.01M13 7h.01M9 17h.01M13 17h.01",
  signal:       "M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16",
  globe:        "M12 22a10 10 0 110-20 10 10 0 010 20zM2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20",
  online:       "M5 12l5 5L20 7",
  offline:      "M18.36 6.64a9 9 0 11-12.73 0M12 2v10",
  deploy:       "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  play:         "M5 3l14 9-14 9V3z",
  pause:        "M6 4h4v16H6zM14 4h4v16h-4z",
  stop:         "M6 6h12v12H6z",
  restart:      "M3 12a9 9 0 109-9 9.75 9.75 0 00-7 3.34L3 8M3 3v5h5",
  install:      "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  database:     "M12 2C6.48 2 2 4.24 2 7s4.48 5 10 5 10-2.24 10-5-4.48-5-10-5zM2 7v5c0 2.76 4.48 5 10 5s10-2.24 10-5V7M2 12v5c0 2.76 4.48 5 10 5s10-2.24 10-5v-5",
  cpu:          "M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m14 0h2M3 15h2m14 0h2M5 5h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM9 9h6v6H9z",
  memory:       "M6 6h12v12H6zM9 6v12M15 6v12M3 9h3M3 13h3M18 9h3M18 13h3",
  network:      "M5 12l-2-2 2-2M19 8l2 2-2 2M14 4l-4 16",
  activity:     "M22 12h-4l-3 9L9 3l-3 9H2",
  heart:        "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z",
  rocket:       "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09zM12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
  spider:       "M12 2v4M9 5l-3 3M15 5l3 3M2 12h4M18 12h4M9 19l-3 3M15 19l3 3M12 18v4M12 6a6 6 0 100 12 6 6 0 000-12z",
  cow:          "M5 4l1 4M19 4l-1 4M9 12c0-1.66 1.34-3 3-3s3 1.34 3 3v3a3 3 0 11-6 0v-3zM7 8c0 5 2 8 5 8s5-3 5-8M9 13h.01M15 13h.01",
  wand:         "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5",
  web:          "M12 22a10 10 0 110-20 10 10 0 010 20zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20M5 5l14 14M19 5L5 19",
  lock:         "M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2zM7 11V7a5 5 0 1110 0v4",
  mail:         "M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM22 6l-10 7L2 6",
  megaphone:    "M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6",
  searchPot:    "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  honeycomb:    "M9 2l3 6h3l3-6M3 8l3 6v6M21 8l-3 6v6M9 22l3-6h3l3 6M3 8h6M15 8h6M3 20h6M15 20h6",
  honeypot:     "M5 8h14l-1 11a3 3 0 01-3 3H9a3 3 0 01-3-3L5 8zM5 8V6a2 2 0 012-2h10a2 2 0 012 2v2M9 12h6M9 16h6",
  party:        "M5.8 11.3L2 22l10.7-3.79M4 3h.01M22 8h.01M15 2h.01M22 20h.01M22 2L11 13",
  info:         "M12 22a10 10 0 110-20 10 10 0 010 20zM12 16v-4M12 8h.01",
  settings:     "M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1zM12 9a3 3 0 100 6 3 3 0 000-6z",
  filter:       "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  external:     "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3",
  hash:         "M4 9h16M4 15h16M10 3L8 21M16 3l-2 18",
  user:         "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0",
  send:         "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  fire:         "M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z",
  spark:        "M5 3v4M3 5h4M6 17v4M4 19h4M13 3l3 7-7 3 7 3-3 7 3-7 7-3-7-3-3-7z",
  star:         "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  hex:          "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z",
  chart:        "M18 20V10M12 20V4M6 20v-6",
  bell:         "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
  clipboard:    "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
} as const;

export type IconName = keyof typeof Icons;

/* ── Pot brand icons ──────────────────────────────
   Each key maps to a brand SVG (replaces emoji per pot type).
*/
export const POT_ICON: Record<string, string> = {
  cowrie:      Icons.cow,
  honnypotter: Icons.wand,
  webtrap:     Icons.spider,
  dionaea:     Icons.fire,
  heralding:   Icons.megaphone,
  elasticpot:  Icons.searchPot,
  mailoney:    Icons.mail,
  glastopf:    Icons.web,
  kippo:       Icons.lock,
};

/** Resolve the brand SVG path for a pot ID. Falls back to the honeypot icon. */
export const potIconPath = (potID: string): string =>
  POT_ICON[potID] ?? Icons.honeypot;
