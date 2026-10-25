import { useCallback, useEffect, useState } from 'react';
import type { StationMaster } from '@dlc/core';
import { listAdmins } from './admin';
import { must, supabase } from './supabase';

/** Game masters per station of one tournament, with every admin to pick from. */
export function useStationMasters(tournamentId: string) {
  const [masters, setMasters] = useState<StationMaster[]>([]);
  const [admins, setAdmins] = useState<{ user_id: string; email: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, list] = await Promise.all([supabase.from('station_masters').select('*').eq('tournament_id', tournamentId).then(must), listAdmins()]);
      setMasters(rows as StationMaster[]);
      setAdmins(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`masters-${tournamentId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_masters', filter: `tournament_id=eq.${tournamentId}` }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [tournamentId, load]);

  const email = new Map(admins.map((a) => [a.user_id, a.email]));
  /** Station number → game master's name (the part of the email before @). */
  const byStation = new Map(masters.map((m) => [m.station, (email.get(m.user_id) ?? 'Admin').split('@')[0]]));

  const assign = async (station: number, userId: string | null) => {
    const q = userId
      ? supabase.from('station_masters').upsert({ tournament_id: tournamentId, station, user_id: userId })
      : supabase.from('station_masters').delete().eq('tournament_id', tournamentId).eq('station', station);
    const { error } = await q;
    if (error) throw new Error(error.message);
    await load();
  };

  return { masters, admins, byStation, assign, error, reload: load };
}
