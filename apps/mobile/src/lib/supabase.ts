import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set');

export const supabase = createClient(url, key, {
  auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// Only refresh tokens while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

export async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/** Upload a local image (from the picker) to the media bucket; returns its public URL. */
export async function uploadLocalImage(uri: string, mimeType: string | undefined, folder: string): Promise<string> {
  const ext = (mimeType?.split('/')[1] ?? uri.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const body = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from('media').upload(path, body, { contentType: mimeType ?? 'image/jpeg' });
  if (error) throw new Error(error.message);
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}
