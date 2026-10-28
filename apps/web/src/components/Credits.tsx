import { useLocation } from 'react-router-dom';

interface Credit {
  name: string;
  /** Employee id. */
  employeeId: string;
  github?: string;
  slack?: string;
}

const CREDITS: Credit[] = [
  {
    name: 'Shoaib Rashid',
    employeeId: '71845',
    github: 'https://github.com/shoaibrashid-tech',
    slack: 'https://dubizzle.slack.com/team/U0AHC47B5PE',
  },
  {
    name: 'Afnan Hussain',
    employeeId: '71562',
    github: 'https://github.com/AfnanHussain10',
    slack: 'https://dubizzle.slack.com/team/U08HRQRH08J',
  },
  {
    name: 'Zain Ul Abidin',
    employeeId: '35915',
    github: 'https://github.com/zainuamalik',
    slack: 'https://dubizzle.slack.com/team/U08K2JUEXU2',
  },
  { name: 'Claude', employeeId: 'GOAT5789' },
];

const githubIcon = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

const slackIcon = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
    <path d="M3.36 10.1a1.68 1.68 0 1 1-1.68-1.68h1.68v1.68Zm.85 0a1.68 1.68 0 1 1 3.36 0v4.22a1.68 1.68 0 1 1-3.36 0V10.1ZM5.89 3.36a1.68 1.68 0 1 1 1.68-1.68v1.68H5.89Zm0 .85a1.68 1.68 0 1 1 0 3.36H1.68a1.68 1.68 0 1 1 0-3.36h4.21Zm6.75 1.68a1.68 1.68 0 1 1 1.68 1.68h-1.68V5.89Zm-.85 0a1.68 1.68 0 1 1-3.36 0V1.68a1.68 1.68 0 1 1 3.36 0v4.21Zm-1.68 6.75a1.68 1.68 0 1 1-1.68 1.68v-1.68h1.68Zm0-.85a1.68 1.68 0 1 1 0-3.36h4.21a1.68 1.68 0 1 1 0 3.36H10.1Z" />
  </svg>
);

/** The people behind the app. `inline` sits in a layout (the live board rail), `end` closes the page (admin); otherwise it is the corner box. */
export function Credits({ inline = false, end = false }: { inline?: boolean; end?: boolean }) {
  return (
    <aside
      aria-label="Powered by"
      className={`credits-box panel neon-gold px-4 py-3 ${inline ? 'credits-inline mt-auto' : end ? 'credits-end' : 'credits-corner'}`}
    >
      <div className="credits-title hud mb-2 text-xs text-flame glow-flame">Powered by</div>
      <ul className="credits-list">
        {CREDITS.map((c) => (
          <li key={c.name} className="credits-person">
            <div className="credits-person-head flex items-baseline gap-2">
              <span className="credits-name font-display text-sm font-bold whitespace-nowrap text-ink">{c.name}</span>
              <span className="credits-id font-mono text-[10px] text-muted">#{c.employeeId}</span>
            </div>
            {(c.github || c.slack) && (
              <div className="credits-links mt-1 flex gap-1.5">
                {c.github && (
                  <a className="credits-link" href={c.github} target="_blank" rel="noopener noreferrer" aria-label={`${c.name} on GitHub`}>
                    {githubIcon}
                    GitHub
                  </a>
                )}
                {c.slack && (
                  <a className="credits-link" href={c.slack} target="_blank" rel="noopener noreferrer" aria-label={`${c.name} on Slack`}>
                    {slackIcon}
                    Slack
                  </a>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * The corner box on the public pages; admin pages put it at the end of the
 * page so it never covers a control. The live board carries it in its own rail.
 */
export function CornerCredits() {
  const { pathname } = useLocation();
  if (pathname === '/live' || pathname.endsWith('/live')) return null;
  if (pathname.startsWith('/admin'))
    return (
      <div className="mx-auto flex max-w-[1600px] justify-end px-4 pb-8">
        <Credits end />
      </div>
    );
  return <Credits />;
}
