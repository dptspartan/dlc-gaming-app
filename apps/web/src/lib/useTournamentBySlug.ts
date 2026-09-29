import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Resolve a tournament slug from the URL to its id. */
export function useTournamentId(slug: string | undefined) {
  const [id, setId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    if (!slug) return;
    setId(null);
    setNotFound(false);
    supabase
      .from('tournaments')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
      .then(({ data }) => (data ? setId(data.id as string) : setNotFound(true)));
  }, [slug]);
  return { id, notFound };
}
