import { formatTime, type TimetableResult } from '@dlc/core';
import { Text } from 'react-native';
import { colors } from './ui';

/** Whether the timetable fits the tournament hours. */
export function FitNote({ result, tz }: { result: TimetableResult | null; tz: string }) {
  if (!result) return null;
  if (result.unplaced.length)
    return <Text style={{ color: colors.red }}>{result.unplaced.length} matches can't be placed: a game needs more stations than it is allowed. Check the games' stations.</Text>;
  if (!result.slots.length) return null;
  return result.fits ? (
    <Text style={{ color: colors.gold }}>Fits in the tournament hours. Last match ends around {formatTime(result.finishesAt, tz)}.</Text>
  ) : (
    <Text style={{ color: colors.red }}>Doesn't fit: the schedule runs about {result.overflowMinutes} minutes past the last day. Add stations, shorten matches, or add a day.</Text>
  );
}
