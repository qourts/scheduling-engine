# Qourts Smart Scheduler: design system and redesign

Branch `ui/qourts-redesign` (from `feature/milestone-3-app`). This is a frontend and UX change only. The scheduling engine, competition rules, schedule calculations, qualification logic and constraints are untouched, and every existing test still passes.

## 1. Audit of the previous interface

Screenshots of the previous state are in [before/](before/).

| Weakness | Evidence |
| --- | --- |
| Generic, not Qourts | White and grey SaaS styling; the brand was a navy "Q" tile and plain text. The official logo was not used anywhere. |
| No visual hierarchy or shell | One flat top bar, pill-shaped stepper, content floating on grey. Nothing said "tournament operations". |
| Matrix: six competing pastel hues | Every division had its own colour (peach, lime, mint, sky, lilac, pink), so colour carried no meaning and fought with state colours. |
| Matrix: almost entirely truncated cards | Cards read `A-R2-2 · 0…`; the match, division and time could not be read without clicking. |
| Matrix: weak state design | Selected, locked, dragged and invalid states were thin outlines or an emoji; conflicts were hard to see. |
| Inspector was a form | Selecting a match showed a move form, not the match: no teams, no sequence, no recovery, no warnings. |
| Native browser dialogs | `window.confirm` for deletes, lock release and restores broke the product feel and accessibility. |
| Thin loading and empty states | A line of grey text while generating; blank areas for empty screens. |
| Styles scattered | One 220-line stylesheet with raw hex values and no token layer. |

## 2. The design system

All of it lives in [`apps/web/src/styles/`](../../apps/web/src/styles): `tokens.css` (values), `base.css` (shared components), `app.css` (shell and screens). Components use semantic tokens, never raw hex values.

**Brand tokens.** Sampled from the official artwork and refined: navy `#0D151F`, mint `#7CDFB9`, turquoise `#5DD0BF`, aqua `#3ACFCF`, cyan `#23BCDB`, and the signature gradient mint → aqua → cyan. The gradient is used sparingly: the one primary call to action per screen, the active-step underline, the hairline under the shell, the recommended schedule's border, medal matches in the dark workspace, and the loading bar.

**Accessible semantic tokens.** The raw brand colours are too light for text on white, so text and focus on light surfaces use a deeper teal (`--accent #0B6F82`). Measured contrast (WCAG):

| Pair | Ratio |
| --- | --- |
| Ink on surface / ink-2 / ink-3 (light) | 18.4 / 8.8 / 5.3 |
| Accent teal on white | 5.8 |
| Shell: white / secondary / tertiary text on navy | 17.0 / 9.6 / 5.7 |
| Mint on navy | 11.5 |
| Navy text on the gradient (mint / aqua / cyan end) | 11.5 / 9.6 / 8.1 |
| Matrix card text: preliminary / semifinal / medal | 18.4 / 10.9 / 18.4 |
| Matrix card borders against the track (light / dark) | 3.3 / 3.6 |
| Focus ring against white | 4.1 |
| Status text on its tint (ok / warn / bad) | 4.9 / 5.5 / 5.7 |

**Type, space, shape, motion.** System font stack (SF Pro, Segoe UI Variable, Inter), a seven-step type scale, a 4 px spacing grid, three radii plus pill, three elevations, short eased transitions that switch off under `prefers-reduced-motion`.

**Iconography.** One inline SVG set (`ui/icons.tsx`): 24 px grid, 1.8 px rounded strokes, `currentColor`, decorative unless titled.

**Components.** Buttons (primary, accent gradient, ghost, danger), fields, pills, banners with icons, segmented controls, tables, cards, progress bar, skeleton, empty state, and a branded confirmation dialog (`ui/confirm.tsx`) that replaces every native `confirm`: focus trapped, Cancel focused first for destructive actions, Escape cancels, focus returns to the opener.

**Interactive and focus states.** One focus treatment everywhere: a 3 px teal ring (mint on the navy shell), plus a soft ring on inputs. Hover, pressed and disabled states are defined once in `base.css`.

## 3. Brand and logo handling

The official asset is used **unmodified**: `apps/web/public/brand/qourts-official-logo.webp`, byte-identical (SHA-256 verified) to the file in the Qourts Site Template. It is not recoloured, cropped, redrawn or stretched, and is never a page background.

**Open item.** The file named in the brief, `Qourts Dark.png`, was not found anywhere on this machine, so it could not be used. The approved logo that does exist has a transparent background and a dark-grey tagline meant for light backgrounds, which would nearly vanish on navy. Within the rule not to modify or invent a variant, the logo sits on a light plate: small in the shell header, large in the home hero. If `Qourts Dark.png` is supplied, only `LOGO_SRC` in `ui/kit.tsx` and the plate styles need to change, and the plate can go.

## 4. Matrix: light or dark workspace

The shell is always navy. For the working area we built both a light and a dark workspace (toggle in the header, remembered per browser) and compared them on the same schedule, using the screenshots [30](after/30-matrix-light-comfortable.png), [31](after/31-matrix-light-detailed.png), [32](after/32-matrix-dark-detailed.png) and [33](after/33-matrix-dark-comfortable-selected.png).

**Decision: light is the default.** Reasons: higher text contrast on cards (18.4:1 versus 12.1:1 for preliminary matches); a white card on a pale grid reads as a distinct object at a glance, whereas dark cards sit close in lightness to the dark track; tournament venues are bright, where glare reduces dark-screen legibility; and printed and projected schedules are light. The dark workspace remains available for dim control rooms and passes the same contrast checks.

## 5. The redesigned matrix

- **Meaning carried by shape and fill, not by many hues.** Preliminary = white card; semifinal or knockout = mint tint; medal = solid navy with a star (mint gradient in the dark workspace). A dashed border marks matches whose players are decided by results. Division identity is the division code as text, with a small dot in one of four brand-family tones chosen per category.
- **Cards sized by real duration** (width = minutes × density), so time positions stay exact. Three densities: Compact, Comfortable, Detailed. Progressive disclosure: compact shows division and match; comfortable adds the time range; detailed adds the two sides. Container queries drop the time line and dot on very narrow cards instead of truncating the match id.
- **States.** Hover lifts with a teal ring; selected has a heavy cyan ring; dragged is dimmed; locked has a navy border, hatching and a lock icon; a conflicting match is outlined red with a warning icon; the drop ghost is mint when allowed and red when not, and the track tints to match.
- **Navigation.** Sticky court labels (with match counts) and sticky time header with hour and half-hour ticks; earlier and later buttons; Jump to selected; density control; day switch. Court rows hold 10 to 20 courts with vertical scrolling.
- **Inspector.** Match id, division and category, stage, group and round, kind, court, day, start and end, both sides (teams and players, or qualification placeholders such as "Winner of XD-ADV SF1" or "1st place, Group A"), the matches that must finish first and those that follow (click to jump), per-team recovery before and after with the rule, engine warnings for that match, lock, move, swap, and the before-and-after impact preview. Technical ids in warnings are shown as readable names.
- **Tablet.** Below 1180 px the inspector sits beside the matrix; below 820 px it becomes a bottom sheet.

## 6. Screens redesigned

Home, setup wizard, special rules, generate and compare, schedule matrix, match inspector, approve and export, and the dialogs, alerts, loading bars and empty states, all on the one token layer and one navy shell with a numbered, progress-aware stepper.

## 7. Before and after

Captured with [capture-scenario.js](capture-scenario.js) (Playwright, 1440×900 desktop and 1024×768 tablet, the guided demo event).

| Screen | Before | After |
| --- | --- | --- |
| Home | [before](before/01-home-desktop.png) | [after](after/01-home-desktop.png) |
| Setup | [before](before/02-setup-event-desktop.png) | [after](after/02-setup-event-desktop.png) |
| Divisions | [before](before/03-setup-divisions-desktop.png) | [after](after/03-setup-divisions-desktop.png) |
| Setup review | [before](before/04-setup-review-desktop.png) | [after](after/04-setup-review-desktop.png) |
| Special rules, review | [before](before/05-rules-review-desktop.png) | [after](after/05-rules-review-desktop.png) |
| Special rules, confirmed | [before](before/06-rules-confirmed-desktop.png) | [after](after/06-rules-confirmed-desktop.png) |
| Compare, empty state | [before](before/07-compare-empty-desktop.png) | [after](after/07-compare-empty-desktop.png) |
| Compare, loading | [before](before/08-compare-loading-desktop.png) | [after](after/08-compare-loading-desktop.png) |
| Compare, summary | [before](before/09-compare-summary-desktop.png) | [after](after/09-compare-summary-desktop.png) |
| Compare, detailed | [before](before/10-compare-detailed-desktop.png) | [after](after/10-compare-detailed-desktop.png) |
| Matrix | [before](before/11-matrix-desktop.png) | [after](after/11-matrix-desktop.png) |
| Matrix, match selected | [before](before/12-matrix-selected-desktop.png) | [after](after/12-matrix-selected-desktop.png) |
| Matrix, locked matches | [before](before/13-matrix-locked-desktop.png) | [after](after/13-matrix-locked-desktop.png) |
| Matrix, invalid move | [before](before/14-matrix-invalid-desktop.png) | [after](after/14-matrix-invalid-desktop.png) |
| Approve and export | [before](before/15-export-desktop.png) | [after](after/15-export-desktop.png) |
| Setup, tablet | [before](before/20-setup-tablet.png) | [after](after/20-setup-tablet.png) |
| Rules, tablet | [before](before/21-rules-tablet.png) | [after](after/21-rules-tablet.png) |
| Compare, tablet | [before](before/22-compare-tablet.png) | [after](after/22-compare-tablet.png) |
| Matrix, tablet | [before](before/23-matrix-tablet.png) | [after](after/23-matrix-tablet.png) |
| Export, tablet | [before](before/24-export-tablet.png) | [after](after/24-export-tablet.png) |

Only in the new design: [confirmation dialog](after/40-dialog-delete.png), [empty matrix](after/41-matrix-empty.png), [20 courts, compact](after/42-matrix-20-courts-compact.png) and [20 courts, selected](after/43-matrix-20-courts-selected.png).

## 8. Functional results

- Engine: 262 tests pass (unchanged); typecheck, build and `npm audit` clean.
- App: 74 tests pass across 11 files (67 existing plus 7 new for the inspector data and the confirmation dialog); typecheck and production build clean.
- Browser: the full workflow and every screen were driven in a real browser at 1440×900 and 1024×768 with no console errors. A 20-court, 192-match event generated in 2.3 s, rendered all 20 rows, and kept the court labels and time header sticky while scrolling.
- Bugs found by reviewing the screenshots and fixed in this pass: flex children squashed to 1 px on dense cards, division codes truncating at compact density, unhandled engine errors when opening later steps on a blank tournament, and card borders below 3:1 contrast.

## 9. Remaining UX limitations

- The logo sits on a light plate until a dark-background variant is supplied (see section 3).
- Drag and drop is mouse-only (HTML5 drag events). Touch and keyboard use select, then the inspector controls.
- Division colour is one of four category tones plus text; divisions inside the same category are told apart by their code. Very wide schedules still need horizontal scrolling by design, to keep time positions exact.
- The dark workspace is an option, not a full dark theme for print and export, which stay light.
- Engine messages are the engine's own wording; only match ids are translated to readable names.
- Visual review covered desktop and tablet widths. Phone widths are not a target.

## 10. Local preview

```bash
npm install
```

```bash
npm run app
```

Open http://localhost:5173 and use **Open example → Guided demo**. The walkthrough in [../operator-walkthrough.md](../operator-walkthrough.md) still applies.
