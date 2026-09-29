/** Shared colour tokens so web and mobile look the same. */
export const theme = {
  bg: '#07070d',
  surface: '#10101c',
  surface2: '#171728',
  border: '#2a2a44',
  text: '#e8e8f5',
  muted: '#8a8aa8',
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  lime: '#b6ff00',
  amber: '#ffb000',
  red: '#ff3b5c',
} as const;

export const statusColor: Record<string, string> = {
  pending: theme.muted,
  ready: theme.cyan,
  live: theme.magenta,
  completed: theme.lime,
};
