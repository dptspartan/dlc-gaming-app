# DLC Gaming Club

Live tournament tracker: public brackets, schedules and a live board for spectators, plus web and mobile admin for organizers.

- **Public web:** tournament list, per-game bracket, schedule and player list, and a full-screen live board that fits every running match on screen and plays a winner announcement when a match ends.
- **Admin web:** game catalog, tournaments, players or teams per game, fixture generation with automatic time slots, fixture editing, start/end/reopen matches, photos.
- **Admin mobile (Expo):** sign in, see live and upcoming matches, start a match, pick the winner, add a score and a photo.

Everything updates in real time through Supabase Realtime.

## Layout

```
apps/web       Vite + React + Tailwind (public site and admin)
apps/mobile    Expo Router app for admins
packages/core  Shared types, bracket generator, scheduler, theme (with tests)
supabase/      Database migrations (schema, security rules, match functions)
scripts/       Demo data generator
```

## How it works

- **Games** live in a catalog with a default match length and **players per side** (1 for solo games, 5 for a five-a-side team game, and so on).
- A **tournament** has a start date, number of days, daily hours and a time zone. Adding a game to a tournament sets its match length, the break between matches and how many **stations** (setups) run it at once.
- **Players or teams are entered per game**, so the EA FC bracket and the Tekken bracket have their own line-ups. Seeds are optional.
- **Generate fixtures** builds a single-elimination bracket through the final. Byes go to the top seeds. Each match gets a station and a time slot inside the daily hours; if it doesn't fit, the admin sees by how much.
- **Match flow** runs in database functions, so web and mobile behave the same: `start_match`, `end_match` (moves the winner into the next match and crowns the champion after the final), `reopen_match` (undo while the next match hasn't started), `swap_slots` (edit matchups before play).
- **Reflow times from now** reschedules unplayed matches when the day runs late or early.
- On the live board, press **W** to replay the latest winner announcement.

## Running locally

```bash
pnpm install
pnpm dev          # web on http://localhost:5173
pnpm mobile       # Expo dev server; open in Expo Go or a dev build
pnpm test         # bracket and scheduling tests
pnpm typecheck
```

The Supabase URL and publishable key are in `apps/web/.env.*` and `apps/mobile/.env`. They are safe to commit: row-level security only lets admins change data.

## Admins

Public sign-up is off; only accounts an admin creates can sign in.

1. In the Supabase dashboard, open **Authentication > Users**, choose **Add user** and tick auto-confirm.
2. Sign in to the web admin as an existing admin and paste the new user's id under **Admins**.

## Deployment

| Workflow | When | Needs |
|---|---|---|
| `ci.yml` | every push and PR | nothing |
| `deploy-web.yml` | push to `main` touching the web app | Settings → Pages → Source: **GitHub Actions** |
| `supabase-migrate.yml` | push to `main` touching `supabase/migrations` | secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (skips without them) |
| `mobile-eas.yml` | run by hand | secret `EXPO_TOKEN`, and run `npx eas init` once in `apps/mobile` |

The web app uses hash URLs (`/#/t/demo-cup`), so it works on GitHub Pages under any repository name.

## Demo data

`pnpm demo-seed > demo.sql` prints SQL for a demo tournament with three games and generated fixtures. Run it in the Supabase SQL editor.
