import type { Tournament } from '@dlc/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Choices, colors, ErrorText, Field, Screen, styles } from '../../../components/ui';
import { pickAndUpload } from '../../../lib/photo';
import { supabase } from '../../../lib/supabase';
import { useTournament } from '../../../lib/useTournament';

const date = /^\d{4}-\d{2}-\d{2}$/;
const clock = /^([01]?\d|2[0-3]):[0-5]\d$/;

type Form = Pick<Tournament, 'name' | 'slug' | 'start_date' | 'days' | 'daily_start' | 'daily_end' | 'timezone' | 'status'>;

/** Name, dates, hours and status of a tournament; and deleting it. */
export default function Details() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useTournament(id);
  const t = data.tournament;
  const [form, setForm] = useState<Form | null>(null);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!t || form) return;
    setForm({ name: t.name, slug: t.slug, start_date: t.start_date, days: t.days, daily_start: t.daily_start.slice(0, 5), daily_end: t.daily_end.slice(0, 5), timezone: t.timezone, status: t.status });
    setDays(String(t.days));
  }, [t, form]);

  if (!t || !form) return <Screen>{null}</Screen>;
  const set = (patch: Partial<Form>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };

  const save = async () => {
    const n = Number(days);
    if (!form.name.trim() || !form.slug.trim()) return setError('Give the tournament a name and a link name.');
    if (!date.test(form.start_date)) return setError('Type the start date as YYYY-MM-DD.');
    if (!Number.isInteger(n) || n < 1 || n > 60) return setError('Days must be between 1 and 60.');
    if (!clock.test(form.daily_start) || !clock.test(form.daily_end)) return setError('Type the hours as HH:MM, for example 10:00.');
    setBusy('save');
    setError(null);
    const { error } = await supabase.from('tournaments').update({ ...form, days: n }).eq('id', t.id);
    setBusy(null);
    if (error) setError(error.message);
    else setSaved(true);
  };

  const banner = async () => {
    setBusy('banner');
    setError(null);
    try {
      const url = await pickAndUpload('banners');
      if (url) {
        const { error } = await supabase.from('tournaments').update({ banner_url: url }).eq('id', t.id);
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert(`Delete ${t.name}?`, 'All its games, players and matches go too. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('tournaments').delete().eq('id', t.id);
          if (error) setError(error.message);
          else router.dismissTo('/');
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Details' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Field label="NAME" value={form.name} onChangeText={(v) => set({ name: v })} />
          <Field label="LINK NAME" hint={`Public page: /t/${form.slug}`} autoCapitalize="none" value={form.slug} onChangeText={(v) => set({ slug: v })} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="START DATE" style={{ flex: 2 }} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" value={form.start_date} onChangeText={(v) => set({ start_date: v })} />
            <Field label="DAYS" style={{ flex: 1 }} keyboardType="number-pad" value={days} onChangeText={(v) => (setSaved(false), setDays(v))} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="DAILY START" style={{ flex: 1 }} placeholder="10:00" keyboardType="numbers-and-punctuation" value={form.daily_start} onChangeText={(v) => set({ daily_start: v })} />
            <Field label="DAILY END" style={{ flex: 1 }} placeholder="20:00" keyboardType="numbers-and-punctuation" value={form.daily_end} onChangeText={(v) => set({ daily_end: v })} />
          </View>
          <Field label="TIME ZONE" autoCapitalize="none" autoCorrect={false} value={form.timezone} onChangeText={(v) => set({ timezone: v })} />
          <Choices
            label="STATUS"
            hint="Drafts are hidden from the public list."
            value={form.status}
            onChange={(v) => set({ status: v })}
            options={[
              ['draft', 'Draft'],
              ['scheduled', 'Scheduled'],
              ['live', 'Live'],
              ['finished', 'Finished'],
            ]}
          />
          <ErrorText message={error} />
          <Button title={saved ? 'Saved' : 'Save'} busy={busy === 'save'} disabled={!!busy} onPress={save} />

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, gap: 10 }}>
            <Text style={styles.label}>Banner image</Text>
            {t.banner_url && <Image source={{ uri: t.banner_url }} style={{ width: '100%', height: 140, borderRadius: 8 }} resizeMode="cover" />}
            <Button title={t.banner_url ? 'Change banner' : 'Add a banner'} variant="ghost" busy={busy === 'banner'} disabled={!!busy} onPress={banner} />
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 }}>
            <Button title="Delete tournament" variant="danger" disabled={!!busy} onPress={remove} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
