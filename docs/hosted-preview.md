# Hosted preview on GitHub Pages

A static build of the redesigned Qourts Smart Scheduler, published from the **`ui/qourts-redesign`** branch (never from `main`) to:

**https://qourts.github.io/scheduling-engine/**

It exists so the redesign can be inspected and tested without running anything locally. It is a preview, not a production system.

## How it is deployed

- Workflow: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml). It runs on every push to `ui/qourts-redesign` and on manual dispatch.
- Steps: install, engine typecheck and tests, engine build, app typecheck and tests, `npm audit`, production build with the hosted settings, build verification, then deploy to Pages.
- Build verification fails the deployment if the page refers to root-relative assets (which would break under the subpath), if the logo is missing, or if the bundle contains anything resembling an API key.
- Vite base path: `/scheduling-engine/` for production builds only. Development (`npm run app`) and tests still use `/`. `VITE_BASE` overrides both, for example to test the subpath locally: `VITE_BASE=/scheduling-engine/ npx vite preview` (on Windows Git Bash prefix with `MSYS_NO_PATHCONV=1`).
- The logo, stylesheet, scripts and the Web Worker are all addressed relative to the base path (`import.meta.env.BASE_URL` and Vite's worker handling). Fonts are the system font stack, so there are none to load.

## One-time repository setup (needs repository admin)

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Settings → Environments → `github-pages` → Deployment branches and tags: allow `ui/qourts-redesign`. By default Pages deployments are restricted to the default branch, and this preview deliberately does not deploy from `main`.

Then push to the branch, or re-run the workflow from the Actions tab.

## What works in the hosted preview

Everything that works locally: setup wizard, deterministic plain-English interpreter and manual rule editor, three-option generation in a Web Worker, comparison, court matrix with drag, swap, lock, undo and redo and engine validation, approval, JSON and CSV export, print, and IndexedDB autosave with JSON import.

Verified by [`hosted-preview-verify.js`](hosted-preview-verify.js), a Playwright scenario that exercises all of that and reports any console error, failed request, request outside the base path, or external request.

## Limitations

- **No AI interpretation.** The optional Claude interpreter needs a server, which static hosting does not have. The hosted build is compiled with `VITE_DISABLE_AI=true`: the AI button is hidden, no request is made, and the screen says so. No key or secret exists in the bundle, and the workflow checks for that. Enabling it would need a separately approved, authenticated backend.
- **Data stays in your browser.** Saved tournaments live in this browser's IndexedDB for `qourts.github.io`. They are not synchronised, backed up or shared, and other browsers or profiles will not see them. Export JSON to keep a copy.
- **Same origin as other Qourts sites.** Browser storage is per origin (`qourts.github.io`), so this preview shares its origin with any other site published under that account. It uses its own database name, but treat it as a preview only.
- **Synthetic data only.** All players, teams and courts in the examples are invented. The "Echelon-style" example borrows the structure of a real event and says so; hide it from the preview if that is not wanted.
- **Not indexed.** The page carries `noindex`, but the URL is public. Do not put real participant data into it.
- **Preview only.** Not for live tournament operations.
