import { describe, expect, it } from 'vitest';
import { shortName, teamShortName } from './names';

describe('shortName', () => {
  it('uses the first name', () => {
    expect(shortName('Abdurrehman Khalid')).toBe('Abdurrehman');
    expect(shortName('Abdullah Haroon')).toBe('Abdullah');
    expect(shortName('Bushra Rashid BAig')).toBe('Bushra');
  });

  it('skips shared prefixes like Syed and Muhammad', () => {
    expect(shortName('Syed muhammad Mujab Hussain')).toBe('Mujab');
    expect(shortName('Muhammad Hamza')).toBe('Hamza');
    expect(shortName('M. Saad')).toBe('Saad');
    expect(shortName('Syed Muhammad')).toBe('Muhammad');
  });

  it('keeps Abdul with the word after it', () => {
    expect(shortName('Abdul Rehman Khan')).toBe('Abdul Rehman');
  });

  it('adds the last initial when two players share a first name', () => {
    expect(shortName('Ali Haider', ['Ali Ahmed', 'Arslan A.'])).toBe('Ali H.');
    expect(shortName('Ali Ahmed', ['Ali Haider'])).toBe('Ali A.');
    expect(shortName('Muhammad Hamza Ali', ['Hamza Shah'])).toBe('Hamza A.');
  });

  it('falls back to the last name, then the full name', () => {
    expect(shortName('Ali Haider', ['Ali Hassan'])).toBe('Ali Haider');
    expect(shortName('Ali Raza Haider', ['Ali Hassan Haider'])).toBe('Ali Raza Haider');
  });

  it('leaves one-word names alone', () => {
    expect(shortName('Fury')).toBe('Fury');
    expect(shortName('  Kilo ')).toBe('Kilo');
  });
});

describe('teamShortName', () => {
  const tg = 'fc';
  it('keeps team names for team entries', () => {
    const team = { name: 'Red Devils United', members: ['A', 'B'], tournament_game_id: tg };
    expect(teamShortName(team, [team])).toBe('Red Devils United');
  });

  it('only checks clashes within the same game', () => {
    const a = { name: 'Ali Haider', members: [], tournament_game_id: tg };
    const b = { name: 'Ali Ahmed', members: [], tournament_game_id: tg };
    const c = { name: 'Ali Raza', members: [], tournament_game_id: 'tekken' };
    expect(teamShortName(a, [a, b, c])).toBe('Ali H.');
    expect(teamShortName(c, [a, b, c])).toBe('Ali');
  });
});
