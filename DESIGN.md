# Design System — DLC Gaming Club × dubizzleLabs

This file covers the **dlc-labs** theme (`<html data-theme="dlc-labs">`). It is the default theme. The classic neon theme stays available from the header switch, and is out of scope here. Every dlc-labs rule lives in `apps/web/src/index.css` under `:root[data-theme="dlc-labs"]`, so classic never picks it up. The brand source is `dlcgaming-assets/asset_board.png`.

## Product Context
- **What this is:** Live tournament tracker for the DLC Gaming Club office events: brackets, groups, stations, a venue live board and an organizer control room.
- **Who it's for:** Players and spectators on phones, everyone at the venue watching the TV live board, and organizers running stations.
- **Space:** Internal culture event with esports-style tooling (brackets, scoreboards).
- **Project type:** Web app (public pages, big-screen board, admin).
- **Memorable thing:** *A fun dubizzleLabs office event.* Playful stickers, the flame-haired mascot and red brand energy, never a corporate tool.
- **Priority surface:** The live board. It is the most visible screen, and people read it from across a room.

## Aesthetic Direction
- **Direction:** Sticker-zine editorial. Dark charcoal, cream paper, red tape labels and white-outlined die-cut stickers.
- **Decoration level:** Expressive, but only at the edges (headers, card corners, celebrations, empty states). Decoration never covers a score, a name, a clock or a station.
- **Mood:** A hand-made event poster that happens to be live, not a sci-fi HUD.
- **Don't:** neon glows, scanlines, gradients, glitch text, terminal copy (`.exe`, `//`), Orbitron, Share Tech Mono.

## Typography
Load both families from Google Fonts so phones, laptops and the venue TV render the same thing. Don't rely on Impact or Arial Narrow being installed: most Android phones have neither.

- **Display / headlines / game names:** Anton. Tall and condensed, with the poster weight of the brand's "GOOD GAMES BETTER PEOPLE" type.
- **Scores and clocks:** Anton with `font-variant-numeric: tabular-nums`.
- **Body / names:** Barlow Condensed 600.
- **UI labels / meta:** Barlow Condensed 700, uppercase, letter-spacing 0.12–0.16em.
- **Hand lettering:** Images only (`logo-lockup.png`, `sticker-game-on.png`). There is no script font.
- **Loading:** `https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@500;600;700;800&display=swap`
- **Scale (web):** 12 / 14 / 16 / 18 / 22 / 28 / 40 / 56 / 80px. Headline h1 is `clamp(2.5rem, 6vw, 5rem)`.
- **Scale (live board):** Size to the viewport, not px. Score `clamp(3rem, 9vh, 10rem)`, clock `clamp(1.5rem, 3.5vh, 3rem)`, names `clamp(1rem, 2.4vh, 2rem)`. On a 1080p TV a score is at least 120px tall.

## Color
- **Approach:** Restrained. Red means *live or act now* and is never decorative fill.
- **Red `#F20D22`:** live state, primary buttons, tape labels, the clock.
- **Paper `#F1EEE5`:** headlines, paper header strips, station tags.
- **Amber `#E2B83F`:** players called, winners, wildcards.
- **Base `#111111` / Surface `#171717`:** page background and cards.
- **Grey `#8F8C85`, Muted `#B6B3AC`:** pending state, meta text, table heads.
- **Lines:** `rgba(241, 238, 229, 0.18)`.
- **Semantic states:** live = red, called = amber, done = paper (winner name in amber), pending = grey, error = red text on surface.
- **Imagery:** Game cover art is grayscale at 10–15% opacity behind a card, never red-tinted.

## Shapes & Components
- **Tape label:** red (or amber/paper) fill, torn clip-path, rotated −1° to −2°. Used for section titles, round titles, rail titles and states.
- **Paper strip:** cream header with a torn bottom edge. Used on bracket cards, live-board cards and the timetable head.
- **State edge:** an inset 4–6px bar on the left of a card. Red for live, amber for called, gold for winner/final.
- **Sticker avatar:** rounded square, 4–6px white outline, hard offset shadow, rotated ±4–5°.
- **Stickers and mascot:** die-cut PNGs from `apps/web/src/assets/dlc/` with a drop shadow. At most one per card, on a corner, and at most one mascot per screen.
- **Game picker:** a card per game with its cover art and name in Anton, plus a small LIVE (red) or DONE (grey) tape. The selected game is a cream paper card rotated −1°. On phones it is one swipeable row.
- **Secondary navigation** (the Games/Stations view switch, sub-tabs): paper or underline treatments. Never solid red, because red is only for live state and primary actions.
- **Meta chips:** outlined pills in Barlow Condensed for format, duration, stations and player count.
- **Champion poster:** a cream paper banner with a red CHAMPION tape, the name in big Anton, the trophy sticker on the left and the mascot on the right.
- **Byes:** a faint dashed slot with no paper header. A bye is a placeholder, not a match.
- **Buttons:** primary is solid red; secondary is surface with a line border; ghost is text-only. 6px radius. No gradients.
- **Badges:** pill with a 1.5px border. LIVE is a solid red fill with a white dot.

## Spacing
- **Base unit:** 4px. **Density:** comfortable on web, spacious on the live board.
- **Scale:** 4, 8, 12, 16, 24, 32, 48, 64.

## Layout
- **Approach:** Hybrid. The grid is strict for data (brackets, tables, stations, the board), and the editorial collage lives only in the event hero.
- **Max width:** 1600px for event pages, 1280px elsewhere. Gutter: 16px on phones.
- **Radius:** sm 4px (tags), md 8px (cards, inputs), lg 12px (board cards), full (badges).

## Motion
- **Approach:** Intentional. Keep the existing springs for cards entering and leaving, the score digit flip, point bursts and the winner takeover.
- **Remove:** neon pulse loops, glitch, scanlines.
- **Duration:** micro 100ms, short 200ms, medium 350ms, celebration up to 1.6s.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-25 | Initial dlc-labs design system | Created by /design-consultation from the brand board. Goal: a fun office event, with the live board as the priority surface. |
| 2026-10-25 | Anton + Barlow Condensed, loaded from Google Fonts | Impact and Arial Narrow aren't on most phones, and the Orbitron / Share Tech Mono leftovers from classic read as sci-fi rather than the zine brand. |
| 2026-10-25 | Live board sized to the viewport | Scores were about 40px on a 1080p TV, too small to read across the venue. |
| 2026-10-25 | Cup page: game picker cards, paper view switch, champion poster, ghost byes | The controls stacked four rows deep with red on secondary navigation, and the champion got the least design on the page. |
| 2026-10-25 | dlc-labs is the default theme | Classic is opt-in from the switch; only an explicit pick is stored (`dlc-theme-choice`). |
| 2026-10-25 | Stickers are dlc-labs only, on corners only | They must never leak into classic or cover live data. |
