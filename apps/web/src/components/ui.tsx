import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { countdown, elapsed, statusColor, statusLabel, type MatchStatus } from '@dlc/core';

type Variant = 'primary' | 'ghost' | 'danger' | 'success';

const variants: Record<Variant, string> = {
  primary:
    'bg-[linear-gradient(90deg,#ff2a4a,#d9001b_55%,#ff1e2d)] text-white shadow-[0_0_22px_rgba(255,42,74,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] hover:shadow-[0_0_32px_rgba(255,30,45,0.55)] [text-shadow:0_1px_6px_rgba(0,0,0,0.45)]',
  ghost: 'border border-line bg-white/5 text-ink backdrop-blur hover:border-ember hover:text-ember hover:shadow-[0_0_18px_rgba(255,42,74,0.3)]',
  danger: 'border border-danger/70 bg-danger/10 text-danger backdrop-blur hover:bg-danger hover:text-bg hover:shadow-[0_0_20px_rgba(255,59,59,0.5)]',
  success: 'bg-[linear-gradient(90deg,#ffc93c,#ff2a4a)] text-bg shadow-[0_0_22px_rgba(255,201,60,0.4),inset_0_1px_0_rgba(255,255,255,0.5)] hover:shadow-[0_0_32px_rgba(255,201,60,0.6)]',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`font-display rounded-lg px-4 py-2 text-xs font-bold tracking-widest uppercase transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
    />
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel p-4 ${className}`}>{children}</div>;
}

export function Heading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="font-display text-2xl font-black tracking-wider uppercase sm:text-4xl">
        {typeof children === 'string' ? (
          <span className="glitch chrome-text" data-text={children}>
            {children}
          </span>
        ) : (
          <span className="chrome-text">{children}</span>
        )}
      </h1>
      {sub && <div className="mt-1 text-muted">{sub}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="field-label hud text-[11px] text-ember/80">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function StatusPill({ status }: { status: MatchStatus | string }) {
  const color = statusColor[status] ?? '#9c8f91';
  return (
    <span
      className="hud inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] backdrop-blur"
      style={{ borderColor: color, color, background: `${color}14`, boxShadow: `0 0 12px ${color}33` }}
    >
      {status === 'live' && <span className="live-dot" style={{ width: 7, height: 7 }} />}
      {statusLabel[status] ?? status}
    </span>
  );
}

export function Avatar({ name, url, size = 36, ring }: { name: string; url?: string | null; size?: number; ring?: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const style = { width: size, height: size, boxShadow: ring ? `0 0 0 2px ${ring}, 0 0 18px ${ring}` : undefined };
  return url ? (
    <img src={url} alt="" className="shrink-0 rounded-lg object-cover" style={style} />
  ) : (
    <div
      className="font-display flex shrink-0 items-center justify-center rounded-lg border border-ember/30 bg-[linear-gradient(135deg,rgba(255,42,74,0.18),rgba(255,30,45,0.18))] font-bold text-ember"
      style={{ ...style, fontSize: size * 0.36, textShadow: '0 0 10px rgba(255,42,74,0.8)' }}
    >
      {initials || '?'}
    </div>
  );
}

/** The current time, ticking every second. */
export function useNow(every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** Ticking mm:ss since a start time. */
export function Elapsed({ since }: { since: string }) {
  const now = useNow();
  return <span className="font-display tabular-nums">{elapsed(since, now)}</span>;
}

/** Ticking m:ss until players must be at their station; red once they are late. */
export function CallCountdown({ calledAt, minutes, className = '' }: { calledAt: string; minutes: number; className?: string }) {
  const now = useNow();
  const left = Math.round((new Date(calledAt).getTime() + minutes * 60_000 - now) / 1000);
  return (
    <span className={`font-display tabular-nums ${left < 0 ? 'text-danger' : 'text-gold'} ${className}`}>
      {left < 0 ? `late ${countdown(-left)}` : countdown(left)}
    </span>
  );
}

/** A row of tabs. */
export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: [K, ReactNode][]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`tab -mb-px shrink-0 border-b-2 px-3 pb-2.5 text-sm font-semibold whitespace-nowrap ${
            value === k ? 'border-ember text-ink' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-lg border border-danger/60 bg-danger/10 px-3 py-2 text-danger backdrop-blur">{message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="hud py-10 text-center text-sm text-muted">// {children}</div>;
}
