/** Shared colour tokens so web and mobile look the same. */
export const theme = {
  bg: '#05030d',
  surface: '#0e0a1f',
  surface2: '#181233',
  /** Frosted glass fill and edge for cards on top of the gradient scene. */
  glass: 'rgba(255,255,255,0.06)',
  glassEdge: 'rgba(160,140,255,0.3)',
  border: 'rgba(140,120,255,0.22)',
  text: '#efeaff',
  muted: '#9a93c4',
  violet: '#8a5cff',
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  lime: '#b6ff00',
  amber: '#ffb000',
  red: '#ff3b5c',
} as const;

export const statusColor: Record<string, string> = {
  pending: '#9a93c4',
  ready: theme.cyan,
  live: theme.magenta,
  completed: theme.lime,
};
