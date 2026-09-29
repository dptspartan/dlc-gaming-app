import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, type Tournament } from '@dlc/core';
import { Layout } from '../components/Layout';
import { Empty, ErrorNote, Heading } from '../components/ui';
import { must, supabase } from '../lib/supabase';

export function Home() {
  const [list, setList] = useState<Tournament[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('tournaments')
      .select('*')
      .neq('status', 'draft')
      .order('start_date', { ascending: false })
      .then((r) => setList(must(r) as Tournament[]))
      .then(undefined, (e: Error) => setError(e.message));
  }, []);

  const groups: [string, Tournament[]][] = [
    ['Live now', list?.filter((t) => t.status === 'live') ?? []],
    ['Upcoming', list?.filter((t) => t.status === 'scheduled') ?? []],
    ['Finished', list?.filter((t) => t.status === 'finished') ?? []],
  ];

  return (
    <Layout>
      <section className="relative mb-10 overflow-hidden py-10 text-center">
        <div className="hud mb-3 text-sm text-cyan">&gt; dlc_arena.exe // live tournament feed</div>
        <div className="font-display text-5xl font-black tracking-[0.12em] uppercase sm:text-7xl">
          <span className="glitch chrome-text" data-text="GAME ON">
            GAME ON
          </span>
        </div>
        <p className="mt-3 text-lg text-muted">Live brackets, schedules and results for every DLC tournament.</p>
        <Link
          to="/live"
          className="font-display mt-8 inline-flex items-center gap-3 rounded-xl border border-pink/70 bg-pink/10 px-7 py-3 text-sm font-bold tracking-widest text-pink uppercase shadow-[0_0_24px_rgba(255,43,214,0.35)] backdrop-blur transition hover:bg-pink hover:text-bg"
        >
          <span className="live-dot" /> Watch live
        </Link>
      </section>
      <ErrorNote message={error} />
      {list && list.length === 0 && <Empty>No tournaments yet. Check back soon.</Empty>}
      {groups.map(
        ([title, items]) =>
          items.length > 0 && (
            <section key={title} className="mb-10">
              <Heading>{title}</Heading>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((t) => (
                  <Link key={t.id} to={`/t/${t.slug}`} className={`panel group relative block overflow-hidden p-0 transition hover:-translate-y-1 ${t.status === 'live' ? 'neon-live' : ''}`}>
                    {t.banner_url ? (
                      <img src={t.banner_url} alt="" className="h-32 w-full rounded-t-[13px] object-cover opacity-80 group-hover:opacity-100" />
                    ) : (
                      <div className="h-32 w-full rounded-t-[13px] bg-[linear-gradient(135deg,rgba(0,240,255,0.35),rgba(138,92,255,0.25),rgba(255,43,214,0.35))] [mask:linear-gradient(#000,transparent)]" />
                    )}
                    <div className="p-4">
                      <div className="font-display text-lg font-bold tracking-wide group-hover:text-cyan">{t.name}</div>
                      <div className="text-muted">
                        {t.start_date}
                        {t.days > 1 ? ` → ${addDays(t.start_date, t.days - 1)}` : ''} · {t.daily_start.slice(0, 5)}–{t.daily_end.slice(0, 5)}
                      </div>
                    </div>
                    {t.status === 'live' && (
                      <span className="hud absolute top-3 right-3 flex items-center gap-2 rounded-full border border-pink/60 bg-bg/60 px-2.5 py-1 text-xs text-pink backdrop-blur">
                        <span className="live-dot" style={{ width: 7, height: 7 }} /> LIVE
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          ),
      )}
    </Layout>
  );
}
