import { groupLetter, groupStandings, qualifiers, type Match, type Team, type TournamentGame } from '@dlc/core';
import { Avatar, StatusPill } from './ui';

/**
 * The group stage of one game: a table per group (wins first, then score
 * difference) with the places that go through highlighted, and the group's
 * matches underneath.
 */
export function GroupTables({
  tg,
  teams,
  matches,
  onMatchClick,
}: {
  tg: TournamentGame;
  teams: Team[];
  matches: Match[];
  onMatchClick?: (m: Match) => void;
}) {
  const grouped = teams.filter((t) => t.group_no != null);
  if (grouped.length === 0) return null;
  const standings = groupStandings(grouped, matches);
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const teamOf = new Map(teams.map((t) => [t.id, t]));
  const through = qualifiers(standings, tg.advance_per_group, tg.wildcards, (id) => nameOf.get(id) ?? '');
  const wildcardIds = new Set(through.slice(standings.size * tg.advance_per_group));
  const groupMatches = matches.filter((m) => m.stage === 'group');
  const done = groupMatches.length > 0 && groupMatches.every((m) => m.status === 'completed');
  const uneven = new Set([...standings.values()].map((rows) => rows.length)).size > 1;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Top {tg.advance_per_group} of each group go through
        {tg.wildcards > 0 ? `, plus the best ${tg.wildcards} of the rest as wildcard${tg.wildcards > 1 ? 's' : ''}` : ''}. Wins count first, then score
        difference, then points scored.
        {uneven ? ' Groups differ in size, so one team sits out each matchday in the smaller groups and teams from different groups are compared per match played.' : ''}{' '}
        {done ? 'The group stage is finished.' : 'Highlighted places are provisional until every group match is played.'}
      </p>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {[...standings].map(([g, rows]) => (
          <div key={g} className="panel p-0">
            <div className="hud border-b border-line px-4 py-2 text-sm text-flame glow-flame">Group {groupLetter(g)}</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted uppercase">
                  <th className="w-8 py-1.5 pl-4 text-left">#</th>
                  <th className="py-1.5 text-left">Team</th>
                  <th className="w-8 text-center">P</th>
                  <th className="w-8 text-center">W</th>
                  <th className="w-8 text-center">L</th>
                  <th className="w-12 text-center">+/-</th>
                  <th className="w-10 pr-4 text-right">For</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = teamOf.get(r.teamId);
                  const q = r.rank <= tg.advance_per_group;
                  const w = wildcardIds.has(r.teamId);
                  return (
                    <tr key={r.teamId} className={`border-t border-line/60 ${q ? 'bg-ember/10' : w ? 'bg-gold/5' : ''}`}>
                      <td className={`py-2 pl-4 font-mono ${q ? 'text-ember' : w ? 'text-gold' : 'text-muted'}`}>{r.rank}</td>
                      <td className="py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={t?.name ?? '?'} url={t?.logo_url} size={22} />
                          <span className="truncate font-bold">{t?.name}</span>
                          {w && <span className="hud rounded border border-gold/60 px-1 text-[9px] text-gold">WC</span>}
                        </span>
                      </td>
                      <td className="text-center font-mono text-muted">{r.played}</td>
                      <td className="text-center font-mono font-bold">{r.won}</td>
                      <td className="text-center font-mono text-muted">{r.lost}</td>
                      <td className={`text-center font-mono ${r.diff > 0 ? 'text-ember' : r.diff < 0 ? 'text-muted' : ''}`}>
                        {r.diff > 0 ? `+${r.diff}` : r.diff}
                      </td>
                      <td className="pr-4 text-right font-mono text-muted">{r.for}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-col divide-y divide-line/50 border-t border-line">
              {groupMatches
                .filter((m) => m.group_no === g)
                .sort((a, b) => a.round - b.round || a.position - b.position)
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!onMatchClick}
                    onClick={() => onMatchClick?.(m)}
                    className={`grid grid-cols-[2.5rem_1fr_auto_1fr_auto] items-center gap-2 px-4 py-1.5 text-left text-sm ${
                      onMatchClick ? 'hover:bg-ember/5' : ''
                    } ${m.status === 'live' ? 'bg-flame/5' : ''}`}
                  >
                    <span className="font-mono text-[11px] text-muted">MD{m.round}</span>
                    <span className={`truncate text-right ${m.winner_id === m.team_a_id ? 'font-bold text-gold' : ''}`}>{nameOf.get(m.team_a_id ?? '')}</span>
                    <span className="font-mono text-xs text-muted">
                      {m.status === 'completed' || m.status === 'live' ? `${m.score_a ?? '·'} – ${m.score_b ?? '·'}` : 'vs'}
                    </span>
                    <span className={`truncate ${m.winner_id === m.team_b_id ? 'font-bold text-gold' : ''}`}>{nameOf.get(m.team_b_id ?? '')}</span>
                    <span className="justify-self-end">{m.status === 'live' ? <StatusPill status="live" /> : null}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
