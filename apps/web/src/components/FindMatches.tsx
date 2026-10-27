import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDay, formatTime, formatWhen, knockoutRounds, matchLabel, scoreLine, sideName, stationLabel, type Match } from '@dlc/core';
import type { LiveData } from '../lib/useLiveData';
import stickerController from '../assets/dlc/sticker-controller.png';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * "Find my matches" for spectators and players: pick a name, see every match
 * of theirs across the event's games, the one that matters now first. The
 * pick lives in the URL (?player=…) so it can be shared or bookmarked.
 */
export function FindMatches({ data, timeZone }: { data: LiveData; timeZone: string }) {
  const [params, setParams] = useSearchParams();
  const picked = params.get('player') ?? '';
  const [query, setQuery] = useState(picked);
  const rounds = useMemo(() => knockoutRounds(data.matches.values()), [data.matches]);

  // One person can be entered in several games: group entries by name.
  const names = useMemo(() => {
    const byName = new Map<string, { name: string; ids: Set<string> }>();
    for (const t of data.teams.values()) {
      const k = norm(t.name);
      const e = byName.get(k) ?? { name: t.name, ids: new Set<string>() };
      e.ids.add(t.id);
      byName.set(k, e);
    }
    return byName;
  }, [data.teams]);

  const q = norm(query);
  const suggestions = q.length >= 2 && norm(picked) !== q ? [...names.values()].filter((n) => norm(n.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8) : [];
  const person = picked ? names.get(norm(picked)) : undefined;

  const pick = (name: string | null) => {
    setQuery(name ?? '');
    const next = new URLSearchParams(params);
    if (name) next.set('player', name);
    else next.delete('player');
    setParams(next, { replace: true });
  };

  const all = useMemo(() => [...data.matches.values()].filter((m) => !m.is_bye), [data.matches]);
  const theirs = person ? all.filter((m) => person.ids.has(m.team_a_id ?? '') || person.ids.has(m.team_b_id ?? '')) : [];
  // Matches they reach if they win one still to play, and the side they would take there.
  const reachSlot = new Map<string, 'a' | 'b'>();
  if (person)
    for (const m of theirs) {
      if (m.status === 'completed' || !m.next_match_id || !m.next_slot) continue;
      const next = data.matches.get(m.next_match_id);
      if (next && !person.ids.has(next.team_a_id ?? '') && !person.ids.has(next.team_b_id ?? '')) reachSlot.set(next.id, m.next_slot);
    }
  const ifTheyWin = [...reachSlot.keys()].map((id) => data.matches.get(id)!);
  const byTime = (a: Match, b: Match) => (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9');
  const now = theirs.find((m) => m.status === 'live') ?? theirs.find((m) => m.status === 'called');
  const upcoming = theirs.filter((m) => m.status === 'ready' || m.status === 'pending').sort(byTime);
  const headline = now ?? upcoming[0];
  const rest = [...theirs.filter((m) => m !== headline), ...ifTheyWin].sort((a, b) => {
    const done = (m: Match) => (m.status === 'completed' ? 1 : 0);
    return done(a) - done(b) || byTime(a, b);
  });

  const team = (id: string | null) => (id ? data.teams.get(id)?.name : undefined);
  const game = (m: Match) => {
    const tg = data.tgames.get(m.tournament_game_id);
    return (tg && data.games.get(tg.game_id)?.name) ?? '';
  };
  const label = (m: Match) => `${game(m)} · ${matchLabel(m, rounds.get(m.tournament_game_id) ?? m.round)}`;
  const opponent = (m: Match) => {
    if (!person) return '';
    const mineA = person.ids.has(m.team_a_id ?? '') || reachSlot.get(m.id) === 'a';
    return mineA ? sideName(m, 'b', team(m.team_b_id)) : sideName(m, 'a', team(m.team_a_id));
  };
  const when = (m: Match) => (m.scheduled_start ? `${formatDay(m.scheduled_start, timeZone)} ${formatTime(m.scheduled_start, timeZone)}` : 'Time TBD');

  return (
    <section className="find-matches mb-6" aria-label="Find my matches">
      <div className="relative max-w-xl">
        <label className="find-box flex items-center gap-2 rounded-xl border border-line bg-white/5 px-3">
          <span aria-hidden="true" className="text-muted">
            ⌕
          </span>
          <input
            type="text"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) pick(null);
            }}
            placeholder="Find your matches: type your name"
            aria-label="Find your matches by name"
            className="find-input min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus:shadow-none"
          />
          {query && (
            <button type="button" onClick={() => pick(null)} className="px-1 text-muted hover:text-ink" aria-label="Clear search">
              ✕
            </button>
          )}
        </label>
        {suggestions.length > 0 && (
          <div className="find-suggestions mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((n) => (
              <button key={n.name} type="button" onClick={() => pick(n.name)} className="find-chip rounded-full border border-line px-3 py-1.5 text-sm font-semibold hover:border-ember">
                {n.name}
              </button>
            ))}
          </div>
        )}
        {q.length >= 2 && !person && suggestions.length === 0 && <p className="mt-2 text-sm text-muted">No player called "{query}" in this event.</p>}
      </div>

      {person && (
        <div className="mt-4 max-w-xl">
          {headline ? (
            <div className="find-ticket panel relative p-4">
              <img className="find-ticket-sticker" src={stickerController} alt="" aria-hidden="true" />
              <div className="find-name font-display text-2xl">{person.name}</div>
              <div className="mt-3 text-xs font-semibold tracking-wider text-muted uppercase">
                {headline.status === 'live' ? 'Playing now' : headline.status === 'called' ? 'Called to the station' : 'Next match'}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <span className="find-time font-display text-3xl">{headline.status === 'live' ? 'Now' : formatWhen(headline.scheduled_start, timeZone)}</span>
                <span className="text-sm font-semibold">
                  {stationLabel(headline) || 'Station TBD'} · {game(headline)}
                </span>
              </div>
              <div className="mt-1 text-sm">
                vs {opponent(headline)} · {matchLabel(headline, rounds.get(headline.tournament_game_id) ?? headline.round)}
                {headline.status === 'live' && headline.score_a != null && ` · ${headline.score_a} : ${headline.score_b}`}
              </div>
            </div>
          ) : (
            <div className="find-ticket panel p-4">
              <div className="find-name font-display text-2xl">{person.name}</div>
              <div className="mt-1 text-sm text-muted">No matches left to play.</div>
            </div>
          )}

          {rest.length > 0 && (
            <ul className="find-rest mt-3 flex flex-col">
              {rest.map((m) => {
                const mine = person.ids.has(m.team_a_id ?? '') || person.ids.has(m.team_b_id ?? '');
                const won = m.status === 'completed' && !!m.winner_id && person.ids.has(m.winner_id);
                return (
                  <li key={m.id} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 border-b border-line py-2.5 text-sm">
                    <span className="font-semibold text-muted">{when(m)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-muted">{label(m)}</span>
                      <span className="block truncate font-semibold">vs {opponent(m)}</span>
                    </span>
                    <span className="find-state max-w-[5.5rem] text-right text-[11px] leading-tight font-bold tracking-wider uppercase">
                      {m.status === 'completed' ? (
                        <span className={won ? 'text-gold' : 'text-muted'}>
                          {won ? 'Won' : 'Lost'} {scoreLine(m, true)}
                        </span>
                      ) : !mine ? (
                        <span className="text-muted">If they win</span>
                      ) : m.status === 'live' ? (
                        <span className="text-flame">Live</span>
                      ) : (
                        <span className="text-muted">{stationLabel(m) || 'Up next'}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
