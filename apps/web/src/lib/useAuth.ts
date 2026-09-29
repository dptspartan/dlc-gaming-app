import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkAdmin = useCallback(async (s: Session | null) => {
    if (!s) {
      setIsAdmin(false);
      return;
    }
    const { data } = await supabase.rpc('is_admin');
    setIsAdmin(Boolean(data));
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await checkAdmin(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void checkAdmin(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [checkAdmin]);

  return { session, isAdmin, loading, refreshAdmin: () => checkAdmin(session) };
}
