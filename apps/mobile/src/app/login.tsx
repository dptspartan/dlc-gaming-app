import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { Button, colors, ErrorText, Screen, styles } from '../components/ui';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export default function Login() {
  const { session, isAdmin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session && isAdmin) return <Redirect href="/" />;

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={[styles.h1, { fontSize: 30, marginBottom: 4 }]}>
          DLC <Text style={{ color: colors.flame }}>GAMING CLUB</Text>
        </Text>
        <Text style={[styles.muted, { marginBottom: 28 }]}>Organizer sign in</Text>
        {session && !isAdmin ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.text}>
              {session.user.email} is not an admin. Ask an admin to add you on the web admin page.
            </Text>
            <Button title="Sign out" variant="ghost" onPress={() => supabase.auth.signOut()} />
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <View>
              <Text style={styles.label}>EMAIL</Text>
              <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
            </View>
            <View>
              <Text style={styles.label}>PASSWORD</Text>
              <TextInput style={styles.input} secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} onSubmitEditing={signIn} />
            </View>
            <ErrorText message={error} />
            <Button title="Sign in" onPress={signIn} busy={busy} disabled={!email || !password} />
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
