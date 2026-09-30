import { theme } from '@dlc/core';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../lib/auth';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0a0a' },
          headerTintColor: theme.ember,
          headerTitleStyle: { fontWeight: '800', color: theme.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'DLC Gaming Club Admin' }} />
        <Stack.Screen name="login" options={{ title: 'Sign in', headerBackVisible: false }} />
        <Stack.Screen name="t/[id]" options={{ title: 'Tournament' }} />
        <Stack.Screen name="station/[n]" options={{ title: 'Station' }} />
        <Stack.Screen name="match/[id]" options={{ title: 'Match', presentation: 'modal' }} />
      </Stack>
    </AuthProvider>
  );
}
