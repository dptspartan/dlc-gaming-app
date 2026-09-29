import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

interface AuthState {
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, isAdmin: false, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, isAdmin: false, loading: true });

  useEffect(() => {
    const apply = async (session: Session | null) => {
      const isAdmin = session ? Boolean((await supabase.rpc('is_admin')).data) : false;
      setState({ session, isAdmin, loading: false });
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => void apply(session));
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
