import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const nav = ({ isActive }: { isActive: boolean }) =>
    `hud rounded-full px-3 py-1 text-xs transition ${isActive ? 'bg-ember/10 text-ember glow-ember shadow-[inset_0_0_0_1px_rgba(255,122,26,0.5)]' : 'text-muted hover:text-ink'}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-[#0d0706]/55 shadow-[0_1px_0_rgba(255,30,45,0.25),0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="font-display text-lg font-black tracking-widest">
            <span className="text-ember glow-ember">DLC</span>
            <span className="text-flame glow-flame"> ARENA</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
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
