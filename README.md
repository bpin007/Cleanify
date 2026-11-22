# Cleanify

Turns broken, messy or foreign text into clean, readable English: repairs mojibake, converts to
plain ASCII, and translates to English. The full plan, decisions and roadmap are in
[PROJECT.md](PROJECT.md), which is the source of truth.

**Status:** Phase 0 (setup). The web and API apps are empty skeletons.

## Prerequisites

- **Node.js 24 LTS** (pinned in `.nvmrc`; CI and hosting use the same version)
- **pnpm 12**, via Corepack, which ships with Node:

  ```sh
  corepack enable pnpm
  ```

  If that fails with `EPERM` on Windows (Node installed in `Program Files`), put the shims in your
  user npm folder instead:

  ```sh
  corepack enable --install-directory "$APPDATA/npm" pnpm
  ```

## Setup

```sh
pnpm install
cp .env.example .env      # fill in values as accounts are created; never commit .env
```

## Commands

| Command              | What it does                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `pnpm dev`           | Starts web (http://localhost:5173) and API (http://localhost:4000) |
| `pnpm test`          | Runs all Vitest suites                                             |
| `pnpm test:coverage` | Tests with coverage (engine)                                       |
| `pnpm lint`          | ESLint over the whole repo                                         |
| `pnpm typecheck`     | `tsc` in every package                                             |
| `pnpm format`        | Prettier, write                                                    |
| `pnpm format:check`  | Prettier, check only (CI)                                          |
| `pnpm build`         | Production builds (web → `apps/web/dist`, API → `apps/api/dist`)   |

The web app always calls same-origin `/api/*`. In development, Vite forwards it to the API
(`API_PROXY_TARGET`); in production, a Cloudflare Pages Function does the same, so login cookies
stay first-party (PROJECT.md correction 6).

## Layout

```
packages/engine   @cleanify/engine — pure TS conversion engine (no DOM, no Node APIs)
packages/shared   @cleanify/shared — shared constants and API types
apps/web          React 18 + Vite + Tailwind
apps/api          Express API
infra/            LibreTranslate Space (Phase 4) and R2 cleanup Worker (Phase 3)
```

## Accounts checklist (owner)

The owner creates every account and key. Secrets go only into `.env` or hosting dashboards, never
into chat or git. **Card-free is a hard rule**: if any step asks for a payment method, stop and
report back before entering one.

| #   | Account                     | Create / turn on                                    | Check and report back                                                                                                                                                          | Needed by                   |
| --- | --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 1   | **GitHub**                  | Empty repo `cleanify`, private                      | Actions enabled (free minutes for private repos)                                                                                                                               | Phase 0                     |
| 2   | **Cloudflare**              | Free account                                        | No card asked at signup                                                                                                                                                        | Phase 0                     |
| 2a  | ↳ **R2**                    | Open R2 in the dashboard                            | **Does turning on R2 ask for a payment method?** (Correction 11.) If yes, stop: don't enter a card                                                                             | Phase 0 check, used Phase 3 |
| 2b  | ↳ **Workers AI**            | Open Workers AI → Models                            | **Is `@cf/meta/m2m100-1.2b` still listed?** What is the **daily free allowance** (neurons/day), and roughly how many characters is that?                                       | Phase 0 check, used Phase 4 |
| 2c  | ↳ **Workers / Pages**       | Nothing to create yet                               | **Workers free plan daily request limit** (the `/api/*` Pages Function proxy counts against it). **Cron Triggers available on the free plan?** (Needed for the cleanup Worker) | Phase 0 check, used Phase 3 |
| 3   | **MyMemory**                | No account; optionally note an email to register    | **Current free limit** anonymous vs with an email (chars/day). Reminder: it's per caller, so it's the total for all users                                                      | Phase 0 check, used Phase 4 |
| 4   | **MongoDB Atlas**           | Free M0 cluster                                     | No card asked; M0 still 512 MB                                                                                                                                                 | Phase 3                     |
| 5   | **Render**                  | Free account (no service yet)                       | No card asked for a free web service; still sleeps after ~15 min / 512 MB                                                                                                      | Phase 3                     |
| 6   | **Google Cloud (OAuth)**    | Project + OAuth consent screen (no credentials yet) | No card or billing account needed for OAuth only                                                                                                                               | Phase 3                     |
| 7   | **Email (Resend or Brevo)** | Nothing yet                                         | Which one is card-free today                                                                                                                                                   | Phase 3                     |
| 8   | **Hugging Face**            | Free account                                        | Free CPU Space specs (RAM), sleep timeout, and **whether free Spaces can be private**                                                                                          | Phase 4                     |

Only items 1–3 are needed to finish Phase 0. The rest can wait until their phase.
