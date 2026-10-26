import { useLocation } from 'react-router-dom';

const CREDITS = ['Shoaib Rashid', 'Afnan Hussain', 'Zain Ul Abidin'];

/** The people behind the app. `inline` sits in a layout (the live board rail); otherwise it is the corner box. */
export function Credits({ inline = false }: { inline?: boolean }) {
  return (
    <aside
      aria-label="Powered by"
      className={`credits-box panel neon-gold px-4 py-3 ${inline ? 'credits-inline mt-auto' : 'credits-corner'}`}
    >
      <div className="credits-title hud mb-2 text-xs text-flame glow-flame">Powered by</div>
      <ul className="credits-list space-y-1">
        {CREDITS.map((name) => (
          <li key={name} className="credits-name font-display text-sm font-bold whitespace-nowrap text-ink">
            {name}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** The corner box on every page except the live board, which carries the credits in its own rail. */
export function CornerCredits() {
  const { pathname } = useLocation();
  if (pathname === '/live' || pathname.endsWith('/live')) return null;
  return <Credits />;
}
