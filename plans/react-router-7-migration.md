# React Router 7 Migration Plan

- **Status:** Proposed
- **Date:** 2026-09-18
- **Owner:** Frontend / dependency-security workstream
- **Depends on / relates to:** `AGENTS.md` dependency policy (react-router 7.x is a
  deferred breaking major), README changelog v1.0.3 note, `plans/decisions/0002-package-topology.md`

## Why

Two open Dependabot advisories against `react-router` only patch in **7.18.0**:

| GHSA | Severity | Vulnerable range | Patched | Summary |
|---|---|---|---|---|
| GHSA-wrjc-x8rr-h8h6 | medium | `>= 6.0.0, < 7.18.0` | 7.18.0 | Open redirect via backslash in `<Link>` / `useNavigate` (CVE-2025-68470 bypass) |
| GHSA-337j-9hxr-rhxg | medium | `>= 6.4.0, < 7.18.0` | 7.18.0 | Arbitrary constructor injection via `deserializeErrors()` in SSR hydration |

Per `AGENTS.md`, react-router 7.x is a deferred breaking major (not to be taken via
Dependabot grouped majors without explicit intent). This plan is that explicit intent:
a scoped, deliberate upgrade rather than an auto-merge.

### Exposure note (why this is medium, not urgent)

- **GHSA-337j-9hxr-rhxg** is specifically an **SSR hydration / `deserializeErrors`**
  issue. This app is a **client-only SPA** (`BrowserRouter`, no `createBrowserRouter`,
  no SSR, no `RouterProvider`, no loaders/actions). The documented exploit path does
  not apply to the current architecture.
- **GHSA-wrjc-x8rr-h8h6** (backslash open-redirect in `<Link>`/`useNavigate`) is
  relevant in principle, but all navigation targets in this app are **hard-coded,
  internal, absolute paths** (`/setup`, `/analyze`, `/results`, etc.) — see inventory
  below. No user-controlled input flows into `to=` or `navigate(...)`. Real-world
  exposure is therefore low.

The upgrade is still worth doing to clear the alerts and stay current, but the low
live-exposure is why it was correctly deferred rather than hot-fixed.

## Current usage inventory (as of 2026-09-18)

Router version: `react-router-dom@6.30.6` (and transitive `react-router@6.30.6`).
React: `18.3.1` (satisfies RR7's React 18+ requirement).

The app uses **only the declarative/library-mode subset** of React Router:

- Router shell: `BrowserRouter` + `<Routes>` / `<Route element={...}>` in `src/App.tsx`
  (NOT the data-router `createBrowserRouter` / `RouterProvider` API).
- Hooks: `useNavigate`, `useLocation` only.
- Components: `Link`, `NavLink` (wrapped in `src/components/NavLink.tsx`), `MemoryRouter`
  (tests only: `AnalyzePage.history.test.tsx`, `ResultsPage.cost.test.tsx`).
- **Not used:** `loader`/`action`, `useLoaderData`, `useActionData`, `defer`, `json()`,
  `RouterProvider`, `deserializeErrors`, `useSearchParams`, `Outlet`, `Navigate`.

Files importing from `react-router-dom`:
`App.tsx`, `components/layout/Header.tsx`, `components/layout/Footer.tsx`,
`components/NavLink.tsx`, `components/ScrollToTop.tsx`, `pages/HomePage.tsx`,
`pages/AnalyzePage.tsx`, `pages/ResultsPage.tsx`, `pages/SetupPage.tsx`,
`pages/DocumentationPage.tsx`, `pages/ApiReferencePage.tsx`, `pages/ChangelogPage.tsx`,
`pages/NotFound.tsx`, and two test files.

All navigation targets are hard-coded internal paths (no dynamic/user-controlled `to`).

### Incidental finding (out of scope for this plan)

`src/App.tsx` has **duplicate `<Route>` entries** for `/results` and `/documentation`
(lines ~31-34). Harmless today (first match wins) but should be de-duplicated in a
separate small cleanup PR — not bundled into the router upgrade.

## Migration strategy

The official incremental guide assumes migrating to a **data router** first. **This app
does not need that.** For a `BrowserRouter`/`<Routes>` SPA, React Router 7 keeps
exporting the same declarative APIs from `react-router-dom`, so a minimal, low-risk
upgrade is viable.

### Recommended path: minimal library-mode bump (low risk)

1. **(Optional, de-risking) Adopt v6 future flags first, ship on v6.**
   Set `future` flags on `<BrowserRouter>` (`v7_startTransition`,
   `v7_relativeSplatPath`) to surface any behavior changes while still on v6. Ship and
   verify. This step is independently revertible.
2. **Bump to v7.** Update `react-router-dom` to `^7.18.0` (drop the deferral in
   `AGENTS.md`). The declarative APIs in use (`BrowserRouter`, `Routes`, `Route`,
   `Link`, `NavLink`, `useNavigate`, `useLocation`, `MemoryRouter`) remain available
   from `react-router-dom` in v7 — a minimal bump needs **no import rewrites**.
   - Note: v7 unifies packages into `react-router`; `react-router-dom` still works as a
     compatibility surface. A later, optional cleanup can switch imports to
     `react-router`, but it is not required to clear the advisories.
3. **Remove any now-redundant transitive pins/overrides** if present, and confirm the
   lockfile resolves `react-router` >= 7.18.0 in every tree.
4. **Verify** (see below) and update docs.

### Explicitly out of scope (do NOT bundle)

- Migrating to `createBrowserRouter`/`RouterProvider` (data router).
- Adopting the v7 Vite plugin / framework mode / SSR / file-based routes.
- The `/results` + `/documentation` duplicate-route cleanup.

These are separate, optional follow-ups; keep the security-driven bump minimal.

## Verification checklist

Per `plans/decisions/0001-verification-command-contract.md`:

- [ ] `npm run lint` — 0 errors (pre-existing legacy warnings unchanged).
- [ ] `npm run typecheck` — clean (watch for RR7 type changes on `NavLink`/`useNavigate`).
- [ ] `npm run test:frontend` — all pass; pay attention to the two `MemoryRouter` tests.
- [ ] `npm run build` — succeeds.
- [ ] Manual smoke: every route (`/`, `/setup`, `/analyze`, `/results`,
      `/documentation`, `/api-reference`, `/changelog`, unknown → `NotFound`),
      `NavLink` active states, `ScrollToTop` on navigation, and programmatic
      `navigate(...)` flows (Setup → Analyze, Home → Analyze/Setup, Results → Analyze).
- [ ] `npm ls react-router react-router-dom` resolves >= 7.18.0 everywhere.
- [ ] Confirm both GHSA alerts close after merge (or dismiss with rationale if a
      residual transitive path remains).

## Rollback

Single-dependency, override-free bump on an isolated branch. Revert = restore the prior
`react-router-dom` range and lockfile entry. No data-layer or architectural changes are
introduced by the recommended path, so rollback is a clean dependency revert.

## Decision needed before implementing

- Confirm we take the **minimal library-mode bump** (recommended) vs. a larger
  data-router/Vite-plugin adoption (deferred).
- On merge, update `AGENTS.md` to remove react-router from the deferred-majors list and
  add a README changelog entry.
