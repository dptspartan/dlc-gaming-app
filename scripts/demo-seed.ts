// Prints SQL for a demo tournament with generated fixtures, for trying the app.
// Usage: npx tsx scripts/demo-seed.ts > supabase/seed.sql
import { randomUUID } from 'node:crypto';
import { generateBracket, scheduleMatches, tournamentWindows } from '../packages/core/src/index';

const q = (v: unknown) => (v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (xs: string[]) => `array[${xs.map(q).join(',')}]::text[]`;

const tournament = {
  id: randomUUID(),
  name: 'DLC Demo Cup',
  slug: 'demo-cup',
  start_date: new Date().toISOString().slice(0, 10),
  days: 2,
  daily_start: '10:00',
  daily_end: '22:00',
  timezone: 'Asia/Karachi',
};

const games = [
  { id: randomUUID(), name: 'EA FC 26', team_size: 1, minutes: 15, stations: 2, players: ['Ace', 'Blaze', 'Cypher', 'Drift', 'Echo', 'Fury'] },
  { id: randomUUID(), name: 'Tekken 8', team_size: 1, minutes: 10, stations: 2, players: ['Kaz', 'Jin', 'Nina', 'Law', 'King', 'Paul', 'Xiao', 'Hwo'] },
  {
    id: randomUUID(),
    name: 'Valorant',
    team_size: 5,
    minutes: 45,
    stations: 1,
    players: ['Night Owls: Ali, Bilal, Hamza, Usman, Zain', 'Red Wolves: Omar, Saad, Fahad, Asad, Rayan', 'Neon Five: Sara, Hira, Amna, Zoya, Maha', 'Glitch: Taha, Moiz, Areeb, Huzaifa, Danish'],
  },
];

const out: string[] = ['-- Demo data: one tournament, three games, generated fixtures.', 'begin;'];
out.push(
  `insert into public.tournaments (id, name, slug, start_date, days, daily_start, daily_end, timezone, status) values (${[
    tournament.id, tournament.name, tournament.slug, tournament.start_date, tournament.days, tournament.daily_start, tournament.daily_end, tournament.timezone, 'scheduled',
  ].map(q).join(', ')});`,
);
const windows = tournamentWindows(tournament);

for (const g of games) {
  const tgId = randomUUID();
  out.push(`insert into public.games (id, name, team_size, default_match_minutes) values (${q(g.id)}, ${q(g.name)}, ${g.team_size}, ${g.minutes});`);
  out.push(
    `insert into public.tournament_games (id, tournament_id, game_id, match_minutes, buffer_minutes, stations, status) values (${q(tgId)}, ${q(tournament.id)}, ${q(g.id)}, ${g.minutes}, 5, ${g.stations}, 'fixtures_ready');`,
  );
  const teams = g.players.map((line, i) => {
    const [name, rest] = line.split(':');
    return { id: randomUUID(), name: name.trim(), members: rest ? rest.split(',').map((s) => s.trim()) : [], seed: i < 2 ? i + 1 : null };
  });
  for (const t of teams) {
    out.push(`insert into public.teams (id, tournament_game_id, name, members, seed) values (${q(t.id)}, ${q(tgId)}, ${q(t.name)}, ${arr(t.members)}, ${q(t.seed)});`);
  }
  const drafts = generateBracket(teams.map((t) => ({ teamId: t.id, seed: t.seed })), { newId: randomUUID });
  const schedule = scheduleMatches(drafts, { windows, matchMinutes: g.minutes, bufferMinutes: 5, stations: g.stations });
  const slot = new Map(schedule.slots.map((s) => [s.id, s]));
  for (const d of drafts) {
    const s = slot.get(d.id);
    out.push(
      `insert into public.matches (id, tournament_id, tournament_game_id, round, position, team_a_id, team_b_id, next_match_id, next_slot, status, is_bye, winner_id, station, scheduled_start, scheduled_end, ended_at) values (${[
        d.id, tournament.id, tgId, d.round, d.position, d.team_a_id, d.team_b_id, d.next_match_id, d.next_slot, d.status, d.is_bye, d.winner_id,
        s?.station ?? null, s ? new Date(s.start).toISOString() : null, s ? new Date(s.end).toISOString() : null, d.is_bye ? new Date().toISOString() : null,
      ].map(q).join(', ')});`,
    );
  }
}
out.push('commit;');
console.log(out.join('\n'));
