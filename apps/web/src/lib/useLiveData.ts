import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Game, Match, Team, Tournament, TournamentGame } from '@dlc/core';
import { must, supabase } from './supabase';

export interface LiveData {
  tournaments: Map<string, Tournament>;
  tgames: Map<string, TournamentGame>;
  games: Map<string, Game>;
  teams: Map<string, Team>;
  matches: Map<string, Match>;
}

const empty = (): LiveData => ({
  tournaments: new Map(),
  tgames: new Map(),
  games: new Map(),
  teams: new Map(),
  matches: new Map(),
});

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

interface Options {
  /** Limit to one tournament. Without it, every scheduled or live tournament is loaded. */
  tournamentId?: string;
  /** Called once when a played match turns completed while the page is open. */
  onMatchCompleted?: (match: Match) => void;
}

/**
 * Loads tournaments, games, teams and matches, then keeps them current with
 * Supabase Realtime so the page updates the moment an admin acts.
 */
export function useLiveData({ tournamentId, onMatchCompleted }: Options = {}) {
  const [data, setData] = useState<LiveData>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  const completedRef = useRef(onMatchCompleted);
  useLayoutEffect(() => {
    dataRef.current = data;
    completedRef.current = onMatchCompleted;
  });

  const load = useCallback(async () => {
    try {
      let tq = supabase.from('tournaments').select('*');
      tq = tournamentId ? tq.eq('id', tournamentId) : tq.in('status', ['scheduled', 'live']);
      const tournaments = must(await tq) as Tournament[];
      const ids = tournaments.map((t) => t.id);
      const safeIds = ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
      const [games, tgames, teams, matches] = await Promise.all([
        supabase.from('games').select('*').then(must),
        supabase.from('tournament_games').select('*').in('tournament_id', safeIds).then(must),
        supabase.from('teams').select('*').in('tournament_id', safeIds).then(must),
        supabase.from('matches').select('*').in('tournament_id', safeIds).then(must),
      ]);
      setData({
        tournaments: byId(tournaments),
        games: byId(games as Game[]),
        tgames: byId(tgames as TournamentGame[]),
        teams: byId(teams as Team[]),
        matches: byId(matches as Match[]),
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const reloadSoon = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void load(), 300);
    };

    const filter = tournamentId ? `tournament_id=eq.${tournamentId}` : undefined;
    const channel = supabase
      .channel(`live-${tournamentId ?? 'all'}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id?: string }).id;
          if (!id) return;
          setData((d) => {
            const matches = new Map(d.matches);
            matches.delete(id);
            return { ...d, matches };
          });
          return;
        }
        const next = payload.new as Match;
        const current = dataRef.current;
        if (!current.tournaments.has(next.tournament_id) || !current.tgames.has(next.tournament_game_id)) {
          reloadSoon();
          return;
        }
        const prev = current.matches.get(next.id);
        if (prev && prev.status !== 'completed' && next.status === 'completed' && !next.is_bye) {
          completedRef.current?.(next);
        }
        setData((d) => ({ ...d, matches: new Map(d.matches).set(next.id, next) }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_games', filter }, reloadSoon)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: tournamentId ? `id=eq.${tournamentId}` : undefined },
        reloadSoon,
      )
      .subscribe((status) => {
        // Catch up on anything missed while the connection was down.
        if (status === 'SUBSCRIBED') reloadSoon();
      });

    return () => {
      clearTimeout(reloadTimer);
      void supabase.removeChannel(channel);
    };
  }, [tournamentId, load]);

  return { data, loading, error, reload: load };
}

/** Handy lookups derived from LiveData. */
export function useLookups(data: LiveData) {
  return useMemo(() => {
    const roundsByTg = new Map<string, number>();
    for (const m of data.matches.values()) {
      roundsByTg.set(m.tournament_game_id, Math.max(roundsByTg.get(m.tournament_game_id) ?? 0, m.round));
    }
    const gameOf = (tgId: string) => {
      const tg = data.tgames.get(tgId);
      return tg ? data.games.get(tg.game_id) : undefined;
    };
    return { roundsByTg, gameOf };
  }, [data]);
}
