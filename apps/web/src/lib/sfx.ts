import { useEffect, useState } from 'react';

/**
 * Sound effects for the public screens (CC0 files in public/sfx). Browsers
 * only allow audio after someone has clicked or pressed a key on the page, so
 * a venue screen needs one click before sounds play.
 */
export type Sfx = 'point' | 'win' | 'champion';

const VOLUME: Record<Sfx, number> = { point: 0.55, win: 0.85, champion: 1 };
const KEY = 'dlc-sound';

let enabled = read();
let unlocked = false;
const listeners = new Set<() => void>();
const cache = new Map<Sfx, HTMLAudioElement>();

function read() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

function source(name: Sfx) {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(`${import.meta.env.BASE_URL}sfx/${name}.mp3`);
    audio.preload = 'auto';
    cache.set(name, audio);
  }
  return audio;
}

function notify() {
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    (['point', 'win', 'champion'] as Sfx[]).forEach(source);
    notify();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function playSfx(name: Sfx) {
  if (!enabled) return;
  // A fresh copy lets quick repeats (two goals in a row) overlap.
  const audio = source(name).cloneNode() as HTMLAudioElement;
  audio.volume = VOLUME[name];
  audio.play().catch(() => {
    // Blocked until the page gets its first click; the toggle says so.
  });
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
  notify();
}

/** Current sound setting, and whether the page has had the click browsers require. */
export function useSound() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { enabled, unlocked, setEnabled: setSoundEnabled };
}
