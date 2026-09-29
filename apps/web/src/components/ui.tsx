import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { elapsed, statusColor, type MatchStatus } from '@dlc/core';

type Variant = 'primary' | 'ghost' | 'danger' | 'success';

const variants: Record<Variant, string> = {
  primary: 'bg-cyan text-bg hover:brightness-110 shadow-[0_0_18px_rgba(0,240,255,0.35)]',
  ghost: 'border border-line text-ink hover:border-cyan hover:text-cyan',
  danger: 'border border-danger text-danger hover:bg-danger hover:text-bg',
  success: 'bg-lime text-bg hover:brightness-110 shadow-[0_0_18px_rgba(182,255,0,0.35)]',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`font-display px-4 py-2 text-xs font-bold tracking-widest uppercase transition disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      style={{ clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)', ...props.style }}
    />
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel p-4 ${className}`}>{children}</div>;
}

export function Heading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="font-display text-2xl font-bold tracking-wider text-cyan uppercase glow-cyan sm:text-3xl">{children}</h1>
      {sub && <div className="mt-1 text-muted">{sub}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-widest text-muted uppercase">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function StatusPill({ status }: { status: MatchStatus | string }) {
  const color = statusColor[status] ?? '#8a8aa8';
  return (
    <span className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs font-bold tracking-widest uppercase" style={{ borderColor: color, color }}>
      {status === 'live' && <span className="live-dot" style={{ width: 7, height: 7 }} />}
      {status}
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
    <img src={url} alt="" className="shrink-0 rounded-md object-cover" style={style} />
  ) : (
    <div
      className="font-display flex shrink-0 items-center justify-center rounded-md bg-surface2 font-bold text-cyan"
      style={{ ...style, fontSize: size * 0.36 }}
    >
      {initials || '?'}
    </div>
  );
}

/** Ticking mm:ss since a start time. */
export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="font-display tabular-nums">{elapsed(since, now)}</span>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="border border-danger/60 bg-danger/10 px-3 py-2 text-danger">{message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-muted">{children}</div>;
}
