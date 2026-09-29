import type { ReactNode } from 'react';

/**
 * Backdrop behind every page: black, with soft blurred neon gaming doodles
 * (controllers, button symbols, pixel invaders...) tiled across the screen.
 */

const RED = '#ff2a4a';
const PINK = '#ff2bd6';
const CYAN = '#22e6ff';
const VIOLET = '#9b5cff';
const LIME = '#b6ff3b';
const YELLOW = '#ffd23c';

/** One doodle: an SVG group drawn around its own origin. */
type Doodle = { x: number; y: number; r: number; s?: number; c: string; d: ReactNode };

const controller = (
  <>
    <path d="M-38 -14 Q-40 -26 -26 -26 L26 -26 Q40 -26 38 -14 L44 16 Q46 30 34 30 Q26 30 20 18 L-20 18 Q-26 30 -34 30 Q-46 30 -44 16 Z" />
    <path d="M-26 -8 v12 M-32 -2 h12" />
    <circle cx="22" cy="-8" r="3" />
    <circle cx="30" cy="0" r="3" />
  </>
);
const triangle = <path d="M0 -18 L17 12 L-17 12 Z" />;
const ring = <circle r="15" />;
const cross = <path d="M-14 -14 L14 14 M14 -14 L-14 14" />;
const square = <rect x="-14" y="-14" width="28" height="28" rx="2" />;
const invader = (
  <path d="M-20 -12 h8 v4 h24 v-4 h8 v8 h4 v12 h-4 v4 h-8 v-4 h-24 v4 h-8 v-4 h-4 v-12 h4 z M-10 -2 h4 v4 h-4 z M6 -2 h4 v4 h-4 z M-16 20 h8 M8 20 h8" />
);
const bolt = <path d="M6 -26 L-12 4 L0 4 L-6 26 L14 -6 L2 -6 Z" />;
const crosshair = (
  <>
    <circle r="18" />
    <circle r="3" />
    <path d="M0 -28 v14 M0 14 v14 M-28 0 h14 M14 0 h14" />
  </>
);
const star = <path d="M0 -20 L6 -6 L21 -6 L9 3 L13 18 L0 9 L-13 18 L-9 3 L-21 -6 L-6 -6 Z" />;
const heart = <path d="M-16 -10 h8 v-4 h8 v4 h0 v-4 h8 v4 h8 v12 h-4 v4 h-4 v4 h-4 v4 h-8 v-4 h-4 v-4 h-4 v-4 h-4 z" />;
const dpad = <path d="M-8 -24 h16 v16 h16 v16 h-16 v16 h-16 v-16 h-16 v-16 h16 z" />;
const ghost = (
  <>
    <path d="M-18 20 V-2 Q-18 -22 0 -22 Q18 -22 18 -2 V20 L12 14 L6 20 L0 14 L-6 20 L-12 14 Z" />
    <circle cx="-7" cy="-4" r="3" />
    <circle cx="7" cy="-4" r="3" />
  </>
);
const headset = (
  <>
    <path d="M-22 6 V-2 Q-22 -24 0 -24 Q22 -24 22 -2 V6" />
    <rect x="-28" y="2" width="10" height="18" rx="4" />
    <rect x="18" y="2" width="10" height="18" rx="4" />
    <path d="M24 20 Q24 28 10 28" />
  </>
);
const trophy = (
  <>
    <path d="M-14 -20 h28 v10 Q14 8 0 8 Q-14 8 -14 -10 Z" />
    <path d="M-14 -14 h-8 Q-22 0 -10 2 M14 -14 h8 Q22 0 10 2 M0 8 v10 M-10 22 h20" />
  </>
);
const gg = (
  <text x="0" y="10" textAnchor="middle" fontFamily="Orbitron, sans-serif" fontWeight="900" fontSize="30" strokeWidth="2.5" fill="none">
    GG
  </text>
);
const joystick = (
  <>
    <rect x="-22" y="8" width="44" height="14" rx="4" />
    <path d="M0 8 V-10" />
    <circle cy="-16" r="8" />
  </>
);

// One 720x720 tile; the pattern repeats it across the page.
const DOODLES: Doodle[] = [
  { x: 90, y: 80, r: -12, c: RED, d: controller },
  { x: 300, y: 60, r: 10, c: CYAN, d: triangle },
  { x: 470, y: 120, r: 0, c: PINK, d: invader },
  { x: 650, y: 70, r: 18, c: YELLOW, d: bolt },
  { x: 200, y: 210, r: 0, c: VIOLET, d: ring },
  { x: 380, y: 250, r: -8, c: RED, d: gg },
  { x: 590, y: 260, r: 12, c: LIME, d: crosshair },
  { x: 60, y: 330, r: 20, c: PINK, d: star },
  { x: 250, y: 380, r: 0, c: RED, d: heart },
  { x: 460, y: 400, r: -15, c: CYAN, d: headset },
  { x: 660, y: 430, r: 45, c: VIOLET, d: cross },
  { x: 120, y: 520, r: 0, c: YELLOW, d: ghost },
  { x: 330, y: 560, r: 8, c: RED, d: joystick },
  { x: 540, y: 560, r: -10, c: PINK, d: dpad },
  { x: 690, y: 640, r: 0, c: LIME, d: trophy },
  { x: 230, y: 670, r: 22, c: CYAN, d: square },
  { x: 440, y: 690, r: -6, c: RED, d: controller, s: 0.8 },
  { x: 40, y: 660, r: 0, c: VIOLET, d: bolt, s: 0.8 },
];

export function Scene() {
  return (
    <div className="scene" aria-hidden>
      <div className="glow" />
      <svg className="doodles" width="100%" height="100%">
        <defs>
          <pattern id="doodle-tile" width="720" height="720" patternUnits="userSpaceOnUse">
            {DOODLES.map((o, i) => (
              <g
                key={i}
                transform={`translate(${o.x} ${o.y}) rotate(${o.r}) scale(${o.s ?? 1})`}
                stroke={o.c}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {o.d}
              </g>
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#doodle-tile)" />
      </svg>
      <div className="scan" />
      <div className="vignette" />
    </div>
  );
}
