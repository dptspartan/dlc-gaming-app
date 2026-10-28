import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Button, ErrorText, Field, Screen } from '../components/ui';
import { slugify } from '../lib/setup';
import { supabase } from '../lib/supabase';

const date = /^\d{4}-\d{2}-\d{2}$/;
const clock = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** A new tournament; it opens straight away so its games can be added. */
export default function NewTournament() {
  const [form, setForm] = useState({
    name: '',
    slug: '',
    start_date: new Date().toISOString().slice(0, 10),
    days: '1',
    daily_start: '10:00',
    daily_end: '20:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const slug = form.slug || slugify(form.name);

  const create = async () => {
    const days = Number(form.days);
    if (!form.name.trim()) return setError('Give the tournament a name.');
    if (!date.test(form.start_date)) return setError('Type the start date as YYYY-MM-DD.');
    if (!Number.isInteger(days) || days < 1 || days > 60) return setError('Days must be between 1 and 60.');
    if (!clock.test(form.daily_start) || !clock.test(form.daily_end)) return setError('Type the hours as HH:MM, for example 10:00.');
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from('tournaments')
      .insert({ ...form, name: form.name.trim(), slug, days })
      .select()
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    router.replace({ pathname: '/t/[id]/setup', params: { id: data.id } });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'New tournament' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Field label="NAME" placeholder="DLC Tournament 1" value={form.name} onChangeText={(v) => set({ name: v })} />
          <Field label="LINK NAME" hint={`Public page: /t/${slug || '...'}`} autoCapitalize="none" placeholder={slugify(form.name)} value={form.slug} onChangeText={(v) => set({ slug: slugify(v) })} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="START DATE" style={{ flex: 2 }} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" value={form.start_date} onChangeText={(v) => set({ start_date: v })} />
            <Field label="DAYS" style={{ flex: 1 }} keyboardType="number-pad" value={form.days} onChangeText={(v) => set({ days: v })} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="DAILY START" style={{ flex: 1 }} keyboardType="numbers-and-punctuation" value={form.daily_start} onChangeText={(v) => set({ daily_start: v })} />
            <Field label="DAILY END" style={{ flex: 1 }} keyboardType="numbers-and-punctuation" value={form.daily_end} onChangeText={(v) => set({ daily_end: v })} />
          </View>
          <Field label="TIME ZONE" autoCapitalize="none" autoCorrect={false} value={form.timezone} onChangeText={(v) => set({ timezone: v })} />
          <ErrorText message={error} />
          <Button title="Create" busy={busy} onPress={create} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
