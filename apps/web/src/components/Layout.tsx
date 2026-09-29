import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const nav = ({ isActive }: { isActive: boolean }) =>
    `font-display text-xs font-bold tracking-widest uppercase transition ${isActive ? 'text-cyan glow-cyan' : 'text-muted hover:text-ink'}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="font-display text-lg font-black tracking-widest">
            <span className="text-cyan glow-cyan">DLC</span>
            <span className="text-pink glow-pink"> ARENA</span>
          </Link>
          <nav className="flex items-center gap-5">
            <NavLink to="/" end className={nav}>
              Events
            </NavLink>
            <NavLink to="/live" className={nav}>
              <span className="inline-flex items-center gap-2">
                <span className="live-dot" style={{ width: 8, height: 8 }} /> Live
              </span>
            </NavLink>
            <NavLink to="/admin" className={nav}>
              Admin
            </NavLink>
          </nav>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? 'max-w-[1600px]' : 'max-w-7xl'}`}>{children}</main>
    </div>
  );
}
