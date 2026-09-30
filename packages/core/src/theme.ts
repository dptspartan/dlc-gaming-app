/** Shared colour tokens so web and mobile look the same. */
export const theme = {
  bg: '#000000',
  surface: '#0f0a0b',
  surface2: '#1a0f11',
  /** Frosted glass fill and edge for cards on top of the gradient scene. */
  glass: 'rgba(255,255,255,0.06)',
  glassEdge: 'rgba(255,60,80,0.3)',
  border: 'rgba(255,50,70,0.22)',
  text: '#fff0f1',
  muted: '#a8999b',
  blaze: '#d9001b',
  ember: '#ff2a4a',
  flame: '#ff1e2d',
  gold: '#ffc93c',
  amber: '#ff6b81',
  red: '#ff3b3b',
} as const;

export const statusColor: Record<string, string> = {
  pending: '#a8999b',
  ready: theme.ember,
  called: theme.gold,
  live: theme.flame,
  completed: theme.gold,
};

/** Plain words for a match status. */
export const statusLabel: Record<string, string> = {
  pending: 'Waiting for teams',
  ready: 'In the queue',
  called: 'Waiting for players',
  live: 'Live',
  completed: 'Done',
};
