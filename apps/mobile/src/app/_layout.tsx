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
          headerStyle: { backgroundColor: '#0b0620' },
          headerTintColor: theme.cyan,
          headerTitleStyle: { fontWeight: '900' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'DLC Arena Admin' }} />
        <Stack.Screen name="login" options={{ title: 'Sign in', headerBackVisible: false }} />
        <Stack.Screen name="t/[id]" options={{ title: 'Matches' }} />
        <Stack.Screen name="match/[id]" options={{ title: 'Match', presentation: 'modal' }} />
      </Stack>
    </AuthProvider>
  );
}
