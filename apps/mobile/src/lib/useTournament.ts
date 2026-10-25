import type { Game, Match, StationMaster, Team, Tournament, TournamentGame } from '@dlc/core';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface TournamentData {
  tournament: Tournament | null;
  tgames: TournamentGame[];
  games: Map<string, Game>;
  teams: Map<string, Team>;
  matches: Match[];
  /** Game master per station. */
  masters: StationMaster[];
}

const empty: TournamentData = { tournament: null, tgames: [], games: new Map(), teams: new Map(), matches: [], masters: [] };

/** One tournament's games, teams and matches, kept live with Supabase Realtime. */
export function useTournament(id: string) {
  const [data, setData] = useState<TournamentData>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, tg, g, tm, m, sm] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', id).single(),
      supabase.from('tournament_games').select('*').eq('tournament_id', id),
      supabase.from('games').select('*'),
      supabase.from('teams').select('*').eq('tournament_id', id),
      supabase.from('matches').select('*').eq('tournament_id', id),
      supabase.from('station_masters').select('*').eq('tournament_id', id),
    ]);
    const err = t.error ?? tg.error ?? g.error ?? tm.error ?? m.error ?? sm.error;
    if (err) setError(err.message);
    else {
      setError(null);
      setData({
        tournament: t.data as Tournament,
        tgames: tg.data as TournamentGame[],
        games: new Map((g.data as Game[]).map((x) => [x.id, x])),
        teams: new Map((tm.data as Team[]).map((x) => [x.id, x])),
        matches: m.data as Match[],
        masters: sm.data as StationMaster[],
      });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`mobile-${id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${id}` }, (payload) => {
        if (payload.eventType === 'DELETE') return void load();
        const next = payload.new as Match;
        setData((d) => ({ ...d, matches: [...d.matches.filter((x) => x.id !== next.id), next] }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `tournament_id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_games', filter: `tournament_id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_masters', filter: `tournament_id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, () => void load())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void load();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, load]);

  return { data, loading, error, reload: load };
}
