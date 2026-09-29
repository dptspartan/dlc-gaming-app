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
        <div className="font-display text-4xl font-black tracking-[0.15em] uppercase sm:text-6xl">
          <span className="text-cyan glow-cyan">Game</span> <span className="text-pink glow-pink">On</span>
        </div>
        <p className="mt-3 text-lg text-muted">Live brackets, schedules and results for every DLC tournament.</p>
        <Link
          to="/live"
          className="font-display mt-6 inline-flex items-center gap-3 border border-pink px-6 py-3 text-sm font-bold tracking-widest text-pink uppercase hover:bg-pink hover:text-bg"
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
                  <Link key={t.id} to={`/t/${t.slug}`} className="panel group relative block overflow-hidden p-0 transition hover:-translate-y-0.5">
                    {t.banner_url ? (
                      <img src={t.banner_url} alt="" className="h-32 w-full object-cover opacity-80 group-hover:opacity-100" />
                    ) : (
                      <div className="h-32 w-full bg-[linear-gradient(135deg,#00f0ff33,#ff2bd633)]" />
                    )}
                    <div className="p-4">
                      <div className="font-display text-lg font-bold tracking-wide group-hover:text-cyan">{t.name}</div>
                      <div className="text-muted">
                        {t.start_date}
                        {t.days > 1 ? ` → ${addDays(t.start_date, t.days - 1)}` : ''} · {t.daily_start.slice(0, 5)}–{t.daily_end.slice(0, 5)}
                      </div>
                    </div>
                    {t.status === 'live' && (
                      <span className="font-display absolute top-3 right-3 flex items-center gap-2 bg-bg/80 px-2 py-1 text-xs font-bold text-pink">
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
