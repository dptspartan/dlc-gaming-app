import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Field, Screen, styles } from '../components/ui';
import { listAdmins } from '../lib/setup';
import { supabase } from '../lib/supabase';

/** Who can run tournaments. Sign-up is off, so an organiser's account is made in Supabase first. */
export default function Admins() {
  const [rows, setRows] = useState<{ user_id: string; email: string }[]>([]);
  const [newId, setNewId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => listAdmins().then(setRows, (e: Error) => setError(e.message)), []);
  useEffect(() => void load(), [load]);

  const add = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('admins').insert({ user_id: newId.trim() });
    setBusy(false);
    if (error) return setError(error.message);
    setNewId('');
    void load();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Admins' }} />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {rows.map((r) => (
          <View key={r.user_id} style={[styles.card, { padding: 12 }]}>
            <Text style={[styles.text, { fontWeight: '700' }]}>{r.email}</Text>
            <Text style={[styles.muted, { fontSize: 12 }]} selectable>
              {r.user_id}
            </Text>
          </View>
        ))}
        <View style={[styles.card, { gap: 10, marginTop: 8 }]}>
          <Text style={styles.label}>Add an admin</Text>
          <Text style={styles.muted}>Sign-up is off. Create the organiser's account in Supabase (Authentication, Users), then paste its user id here.</Text>
          <Field label="USER ID" autoCapitalize="none" autoCorrect={false} value={newId} onChangeText={setNewId} />
          <ErrorText message={error} />
          <Button title="Add" busy={busy} disabled={!newId.trim()} onPress={add} />
        </View>
      </ScrollView>
    </Screen>
  );
}
