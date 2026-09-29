import { elapsed, statusColor, theme } from '@dlc/core';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export const colors = theme;

export function Screen({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: theme.bg }}>{children}</View>;
}

type Variant = 'primary' | 'success' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'primary' ? theme.cyan : variant === 'success' ? theme.lime : 'transparent';
  const fg = variant === 'primary' || variant === 'success' ? theme.bg : variant === 'danger' ? theme.red : theme.text;
  const border = variant === 'danger' ? theme.red : variant === 'ghost' ? theme.border : bg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title.toUpperCase()}</Text>}
    </Pressable>
  );
}

export function Pill({ status }: { status: string }) {
  const color = statusColor[status] ?? theme.muted;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 6 }} />;
  return (
    <View style={[styles.avatar, { width: size, height: size }]}>
      <Text style={{ color: theme.cyan, fontWeight: '800', fontSize: size * 0.36 }}>{initials || '?'}</Text>
    </View>
  );
}

export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <Text style={{ color: theme.magenta, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{elapsed(since, now)}</Text>;
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

export const styles = StyleSheet.create({
  button: { paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  buttonText: { fontWeight: '800', letterSpacing: 2, fontSize: 13 },
  pill: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  avatar: { backgroundColor: theme.surface2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, padding: 12, borderRadius: 4 },
  h1: { color: theme.cyan, fontSize: 22, fontWeight: '900', letterSpacing: 2 },
  label: { color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  text: { color: theme.text, fontSize: 16 },
  muted: { color: theme.muted, fontSize: 14 },
  input: { backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, color: theme.text, padding: 12, fontSize: 16, borderRadius: 4 },
  error: { color: theme.red, marginVertical: 8 },
});
