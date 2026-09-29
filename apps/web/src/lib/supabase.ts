import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Throw the Supabase error message instead of returning it. */
export function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** Upload an image to the public media bucket and return its URL. */
export async function uploadImage(file: File, folder: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('media').upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}
