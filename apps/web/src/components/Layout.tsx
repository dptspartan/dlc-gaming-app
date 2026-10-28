import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ThemeSwitch } from '../lib/theme';
import { useAuth } from '../lib/useAuth';
import dlcLockup from '../assets/dlc/logo-lockup.png';

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  // Organisers signed in on this device get a way back to the admin from any page; the public never sees it.
  const { isAdmin } = useAuth();
  const nav = ({ isActive }: { isActive: boolean }) =>
    `hud rounded-full px-3 py-1 text-xs transition ${isActive ? 'bg-ember/10 text-ember glow-ember shadow-[inset_0_0_0_1px_rgba(255,42,74,0.5)]' : 'text-muted hover:text-ink'}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-[#0a0a0a]/55 shadow-[0_1px_0_rgba(255,30,45,0.25),0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="font-display text-lg font-black tracking-widest">
            <span className="text-ember glow-ember">DLC</span>
            <span className="text-flame glow-flame"> GAMING CLUB</span>
            <img className="brand-lockup" src={dlcLockup} alt="DLC Gaming Club × dubizzleLabs" />
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
            {isAdmin && (
              <NavLink to="/admin" className="admin-pill hud ml-1 rounded-full border border-ember/60 px-3 py-1 text-xs text-ink hover:bg-ember/10">
                Admin
              </NavLink>
            )}
            <ThemeSwitch className="ml-1 sm:ml-3" />
          </nav>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? 'max-w-[1600px]' : 'max-w-7xl'}`}>{children}</main>
      {!isAdmin && (
        <footer className="mx-auto max-w-7xl px-4 pt-6 pb-10 text-center">
          <Link to="/admin" className="site-footer-link text-xs text-muted hover:text-ink">
            Organisers
          </Link>
        </footer>
      )}
    </div>
  );
}
