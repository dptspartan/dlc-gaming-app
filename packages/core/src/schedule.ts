import { MINUTE, type DayWindow } from './time';
import type { MatchStatus } from './types';

export interface SchedulableMatch {
  id: string;
  round: number;
  position: number;
  next_match_id: string | null;
  status: MatchStatus;
  is_bye: boolean;
  station?: number | null;
  /** Group matches all come before the knockout. */
  stage?: 'group' | 'knockout';
  /** Known players/teams; a team is never booked into two overlapping matches. */
  team_a_id?: string | null;
  team_b_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface ScheduleOptions {
  windows: DayWindow[];
  matchMinutes: number;
  bufferMinutes: number;
  stations: number;
  /** When rescheduling mid-event, nothing is placed before this instant (ms). */
  now?: number;
}

export interface SlotAssignment {
  id: string;
  station: number;
  start: number;
  end: number;
  overflow: boolean;
}

export interface ScheduleResult {
  slots: SlotAssignment[];
  /** True when every match fits inside the tournament's days and hours. */
  fits: boolean;
  /** How far past the last day's closing time the schedule runs. */
  overflowMinutes: number;
  finishesAt: number | null;
}

const stageOrder = (m: SchedulableMatch) => (m.stage === 'group' ? 0 : 1);

/**
 * Give each unplayed match a station and a time slot. Rounds are played in
 * order, a match never starts before both feeder matches (plus buffer) are
 * done, and a match that would run past a day's closing time moves to the
 * next day's opening time.
 */
export function scheduleMatches(matches: SchedulableMatch[], options: ScheduleOptions): ScheduleResult {
  const { windows, stations } = options;
  if (windows.length === 0) throw new Error('The tournament needs at least one day');
  if (stations < 1) throw new Error('At least one station is needed');

  const duration = options.matchMinutes * MINUTE;
  const buffer = options.bufferMinutes * MINUTE;
  const lastClose = windows[windows.length - 1].end;
  const floor = Math.max(windows[0].start, options.now ?? -Infinity);

  const readyAt = new Map<string, number>();
  const stationFree = Array.from({ length: stations }, () => floor);
  const teamFree = new Map<string, number>();
  const bookTeams = (m: SchedulableMatch, until: number) => {
    for (const t of [m.team_a_id, m.team_b_id]) if (t) teamFree.set(t, Math.max(teamFree.get(t) ?? -Infinity, until));
  };

  for (const m of matches) {
    if (m.is_bye) {
      readyAt.set(m.id, -Infinity);
    } else if (m.status === 'completed') {
      readyAt.set(m.id, (m.ended_at ? new Date(m.ended_at).getTime() : floor) + buffer);
      bookTeams(m, readyAt.get(m.id)!);
    } else if (m.status === 'live') {
      const started = m.started_at ? new Date(m.started_at).getTime() : floor;
      const expectedEnd = Math.max(started + duration, options.now ?? 0);
      readyAt.set(m.id, expectedEnd + buffer);
      bookTeams(m, expectedEnd + buffer);
      if (m.station && m.station <= stations) {
        stationFree[m.station - 1] = Math.max(stationFree[m.station - 1], expectedEnd + buffer);
      }
    }
  }

  const feeders = new Map<string, string[]>();
  for (const m of matches) {
    if (!m.next_match_id) continue;
    feeders.set(m.next_match_id, [...(feeders.get(m.next_match_id) ?? []), m.id]);
  }

  const todo = matches
    .filter((m) => !m.is_bye && (m.status === 'pending' || m.status === 'ready'))
    .sort((a, b) => stageOrder(a) - stageOrder(b) || a.round - b.round || a.position - b.position);
  // The knockout waits for the whole group stage.
  const groupIds = matches.filter((m) => m.stage === 'group').map((m) => m.id);
  const groupsDone = () => Math.max(floor, ...groupIds.map((id) => readyAt.get(id) ?? floor));

  const fitIntoWindows = (earliest: number): { start: number; overflow: boolean } => {
    for (const w of windows) {
      if (earliest >= w.end) continue;
      const start = Math.max(earliest, w.start);
      if (start + duration <= w.end) return { start, overflow: false };
    }
    return { start: Math.max(earliest, lastClose), overflow: true };
  };

  const slots: SlotAssignment[] = [];
  for (const m of todo) {
    const deps = (feeders.get(m.id) ?? []).map((id) => readyAt.get(id) ?? floor);
    const busy = [m.team_a_id, m.team_b_id].map((t) => (t ? teamFree.get(t) ?? floor : floor));
    const earliest = Math.max(floor, ...deps, ...busy, m.stage !== 'group' && groupIds.length ? groupsDone() : floor);

    let best = 0;
    for (let s = 1; s < stations; s++) {
      if (Math.max(stationFree[s], earliest) < Math.max(stationFree[best], earliest)) best = s;
    }
    const { start, overflow } = fitIntoWindows(Math.max(stationFree[best], earliest));
    const end = start + duration;
    stationFree[best] = end + buffer;
    readyAt.set(m.id, end + buffer);
    bookTeams(m, end + buffer);
    slots.push({ id: m.id, station: best + 1, start, end, overflow });
  }

  const finishesAt = slots.length ? Math.max(...slots.map((s) => s.end)) : null;
  const overflowMinutes = finishesAt != null && finishesAt > lastClose ? Math.ceil((finishesAt - lastClose) / MINUTE) : 0;
  return { slots, fits: !slots.some((s) => s.overflow), overflowMinutes, finishesAt };
}

export interface TimedTeamMatch {
  id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: MatchStatus;
}

export interface TeamConflict {
  teamId: string;
  matchIds: [string, string];
}

/** A team booked in two matches whose time slots overlap (e.g. across games). */
export function findTeamConflicts(matches: TimedTeamMatch[]): TeamConflict[] {
  const byTeam = new Map<string, TimedTeamMatch[]>();
  for (const m of matches) {
    if (m.status === 'completed' || !m.scheduled_start || !m.scheduled_end) continue;
    for (const t of [m.team_a_id, m.team_b_id]) {
      if (t) byTeam.set(t, [...(byTeam.get(t) ?? []), m]);
    }
  }
  const conflicts: TeamConflict[] = [];
  for (const [teamId, list] of byTeam) {
    const sorted = [...list].sort((a, b) => a.scheduled_start!.localeCompare(b.scheduled_start!));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (new Date(cur.scheduled_start!).getTime() < new Date(prev.scheduled_end!).getTime()) {
        conflicts.push({ teamId, matchIds: [prev.id, cur.id] });
      }
    }
  }
  return conflicts;
}
