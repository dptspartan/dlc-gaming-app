/** Shared colour tokens so web and mobile look the same. */
export const theme = {
  bg: '#070403',
  surface: '#140b08',
  surface2: '#1f120d',
  /** Frosted glass fill and edge for cards on top of the gradient scene. */
  glass: 'rgba(255,255,255,0.06)',
  glassEdge: 'rgba(255,120,70,0.3)',
  border: 'rgba(255,110,60,0.22)',
  text: '#fff3ec',
  muted: '#b59a8f',
  blaze: '#ff4d00',
  ember: '#ff7a1a',
  flame: '#ff1e2d',
  gold: '#ffc93c',
  amber: '#ffb000',
  red: '#ff3b3b',
} as const;

export const statusColor: Record<string, string> = {
  pending: '#b59a8f',
  ready: theme.ember,
  live: theme.flame,
  completed: theme.gold,
};
