import { elapsed, statusColor, theme } from '@dlc/core';
import { useEffect, useState, type ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export const colors = theme;

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Synthwave backdrop: purple gradient, glowing horizon and a neon grid floor. */
function Scene() {
  const lines = [0, 10, 24, 44, 72, 110, 160];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['#070403', '#1c0b07', '#3a0c08', '#070403']} locations={[0, 0.45, 0.62, 1]} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: '62%', bottom: 0 }}>
        <View style={{ height: 2, backgroundColor: theme.flame, opacity: 0.8, shadowColor: theme.flame, shadowOpacity: 1, shadowRadius: 12 }} />
        {lines.map((y) => (
          <View key={y} style={{ position: 'absolute', left: 0, right: 0, top: y * 1.6, height: 1, backgroundColor: theme.flame, opacity: 0.25 }} />
        ))}
      </View>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Scene />
      {children}
    </View>
  );
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
  const gradient: [string, string, ...string[]] | null =
    variant === 'primary' ? [theme.ember, theme.blaze, theme.flame] : variant === 'success' ? [theme.gold, theme.ember] : null;
  const fg = variant === 'primary' ? '#ffffff' : variant === 'success' ? theme.bg : variant === 'danger' ? theme.red : theme.text;
  const border = variant === 'danger' ? theme.red : variant === 'ghost' ? theme.glassEdge : 'transparent';
  const glow = variant === 'primary' ? theme.flame : variant === 'success' ? theme.gold : variant === 'danger' ? theme.red : theme.ember;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: gradient ? 'transparent' : variant === 'danger' ? 'rgba(255,59,59,0.1)' : theme.glass,
          borderColor: border,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
          shadowColor: glow,
          shadowOpacity: gradient ? 0.6 : 0,
          shadowRadius: 14,
          elevation: gradient ? 6 : 0,
        },
        style,
      ]}
    >
      {gradient && <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />}
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg, textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: variant === 'primary' ? 6 : 0 }]}>{title.toUpperCase()}</Text>
      )}
    </Pressable>
  );
}

export function Pill({ status }: { status: string }) {
  const color = statusColor[status] ?? theme.muted;
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: `${color}1f`, shadowColor: color, shadowOpacity: 0.6, shadowRadius: 6 }]}>
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
      <Text style={{ color: theme.ember, fontWeight: '800', fontSize: size * 0.36 }}>{initials || '?'}</Text>
    </View>
  );
}

export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Text style={{ color: theme.ember, fontFamily: mono, fontWeight: '700', fontVariant: ['tabular-nums'], textShadowColor: theme.ember, textShadowRadius: 8 }}>
      {elapsed(since, now)}
    </Text>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

export const styles = StyleSheet.create({
  button: { paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, overflow: 'visible' },
  buttonText: { fontWeight: '900', letterSpacing: 2.5, fontSize: 13 },
  pill: { borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start', borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, fontFamily: mono },
  avatar: { backgroundColor: 'rgba(255,122,26,0.14)', borderColor: 'rgba(255,122,26,0.35)', borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: theme.glass,
    borderColor: theme.glassEdge,
    borderWidth: 1,
    padding: 14,
    borderRadius: 14,
    shadowColor: theme.ember,
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  cardLive: { borderColor: theme.flame, backgroundColor: 'rgba(255,30,45,0.08)', shadowColor: theme.flame, shadowOpacity: 0.55, shadowRadius: 18, elevation: 8 },
  h1: { color: theme.ember, fontSize: 22, fontWeight: '900', letterSpacing: 3, textShadowColor: theme.ember, textShadowRadius: 14 },
  label: { color: theme.ember, opacity: 0.85, fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: 6, fontFamily: mono },
  text: { color: theme.text, fontSize: 16 },
  muted: { color: theme.muted, fontSize: 14 },
  mono: { fontFamily: mono, letterSpacing: 1.5 },
  input: {
    backgroundColor: 'rgba(7,4,3,0.6)',
    borderColor: theme.glassEdge,
    borderWidth: 1,
    color: theme.text,
    padding: 13,
    fontSize: 16,
    borderRadius: 10,
  },
  error: { color: theme.red, marginVertical: 8 },
});
