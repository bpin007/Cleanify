# Cleanify — Project Plan

> **Status:** Phases 0 and 1 merged into `main`. Phase 2 (website, browser mode) in progress on `phase-2-web`: home page and result view ready for the owner's look-and-feel review.
> **Last updated:** 2026-11-23 (decisions D12–D13 added in Phase 2)
> **Working name:** Cleanify (kept in one config value so it can be renamed easily)

---

## Table of contents

1. [What is Cleanify?](#1-what-is-cleanify)
2. [The problem we are solving](#2-the-problem-we-are-solving)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Who it is for](#4-who-it-is-for)
5. [What it does — the three-stage pipeline](#5-what-it-does--the-three-stage-pipeline)
6. [How people use it — modes and accounts](#6-how-people-use-it--modes-and-accounts)
7. [Supported inputs and outputs](#7-supported-inputs-and-outputs)
8. [Pages and user flows](#8-pages-and-user-flows)
9. [Design system](#9-design-system)
10. [Architecture](#10-architecture)
11. [Tech stack](#11-tech-stack)
12. [Repository structure](#12-repository-structure)
13. [The conversion engine](#13-the-conversion-engine)
14. [Backend — API, data, storage](#14-backend--api-data-storage)
15. [Translation service](#15-translation-service)
16. [Public developer API](#16-public-developer-api)
17. [Security and privacy](#17-security-and-privacy)
18. [Limits and quotas](#18-limits-and-quotas)
19. [Lessons from the reference tool (bugs we must not repeat)](#19-lessons-from-the-reference-tool-bugs-we-must-not-repeat)
20. [Testing strategy](#20-testing-strategy)
21. [Deployment and environments](#21-deployment-and-environments)
22. [How we will build it — team and workflow](#22-how-we-will-build-it--team-and-workflow)
23. [Roadmap and phases](#23-roadmap-and-phases)
24. [Risks and open questions](#24-risks-and-open-questions)
25. [Glossary](#25-glossary)

---

## 1. What is Cleanify?

Cleanify is a free web tool, with optional accounts, that turns **broken, messy or foreign text into clean, readable English**.

Paste text or drop a file, and Cleanify:

1. **Repairs garbled text** ("mojibake"), for example `CafÃ©` → `Café`, `donâ€™t` → `don’t`.
2. **Converts accents and special characters to plain ASCII**, for example `Café` → `Cafe`, `“smart quotes”` → `"smart quotes"`, and removes invisible characters.
3. **Translates to English** when the text is in another language, for example `Bonjour, ça va ?` → `Hello, how are you?`.

Each stage can be switched on or off. Every change is shown before it is applied, and the user can accept or reject each one.

It is a **complete MERN-stack product**:

- **MongoDB:** users, jobs, rules, API keys, translation cache.
- **Express:** the API server.
- **React:** the website.
- **Node.js:** the runtime.

Files are stored in **Cloudflare R2**.

---

## 2. The problem we are solving

Text breaks constantly when it moves between systems:

| Problem | Example | Where it comes from |
|---|---|---|
| Mojibake (wrong encoding) | `JosÃ© GarcÃ­a`, `â€œquoteâ€` | UTF-8 opened as Windows-1252: Excel CSV imports, old databases, emails |
| Double mojibake | `ÃƒÂ©` instead of `é` | Text garbled twice by passing through two broken systems |
| Accents that break systems | `Müller`, `São Paulo` | Systems that only accept ASCII: legacy software, IDs, file names, URLs |
| Typographic characters | `’ “ ” – — …` | Copying from Word, Google Docs or websites |
| Invisible characters | zero-width space, non-breaking space, BOM | Copying from web pages and PDFs; causes "why don't these match?" bugs |
| Foreign-language text | `Rechnung bezahlt` | International customers, mixed-language datasets |

Today people fix these with a mix of find-and-replace, online "remove accents" sites, Google Translate and custom scripts. **Cleanify does all of it in one place, safely, with a preview.**

---

## 3. Goals and non-goals

### Goals

- **One tool, three fixes:** repair encoding, convert to ASCII, translate to English.
- **Safe by default:** never change text without showing the change. Never "fix" text that isn't broken (for example, real French `«CAFÉ»` must stay untouched).
- **Private by default:** encoding repair and ASCII conversion run entirely in the browser. Nothing is uploaded unless the user chooses cloud mode or translation.
- **Works without an account**, like iLovePDF: open the site, use it, download, leave.
- **More with an account:** history, saved files, custom rules, API keys.
- **Developer API** for automated use.
- **Card-free to run:** every external service used at launch has a free tier that needs no credit card.
- **Correct:** a test suite built from real-world broken files, including every bug found in the reference tool (section 19).

### Non-goals (for version 1)

- Translating into languages other than English.
- Editing document layout (Word or PDF formatting). We clean text, not layouts.
- Writing Microsoft Access (`.accdb`) files. Browsers and Node can't do this reliably, so Access input is exported as `.xlsx`.
- Native mobile apps. The website is responsive instead.
- Paid plans and billing. The structure allows adding them later.

---

## 4. Who it is for

Cleanify is for all purposes. The wording on the site stays plain so anyone can use it, and the advanced features stay available.

| User | Typical task | What they need most |
|---|---|---|
| **General users** | "My copied text has weird symbols" | Paste box, one click, copy result |
| **Data and ops people** | Cleaning CSV or Excel exports before import | File upload, row and column locations, safe export that keeps the file structure |
| **Developers** | Cleaning text inside their own apps | REST API, API keys, clear docs |
| **Content writers and translators** | Normalizing quotes, removing hidden characters, quick translation | Before/after view, per-change control |

---

## 5. What it does — the three-stage pipeline

```
Input text / file
      │
      ▼
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────────┐
│ Stage 1              │   │ Stage 3 (optional)   │   │ Stage 2                  │
│ Repair garbled text  │──▶│ Translate to English │──▶│ Accents → plain ASCII    │
│ (mojibake)           │   │                      │   │ + invisible char cleanup │
│ ON by default        │   │ toggle (cloud only)  │   │ toggle                   │
│ runs in browser      │   │ runs on server       │   │ runs in browser          │
└──────────────────────┘   └──────────────────────┘   └──────────────────────────┘
      │
      ▼
Preview (before/after diff) → accept / reject changes → download / copy
```

**Run order: Stage 1 → Stage 3 → Stage 2.** The stage numbers are names, not the run order (they match the order of the toggles in the UI).

The order matters:
- Garbled text must be repaired before accents are removed. Otherwise `CafÃ©` would become `CafA` instead of `Cafe`.
- Translation runs on the repaired text, so the translator never sees mojibake.
- Stage 2 runs last, on the English output when translation is on, or on the repaired text when it is off. This way the translator gets the real accented words (`Café`, not `Cafe`), which it translates better.

When Stage 3 is off, the pipeline is simply Stage 1 → Stage 2.

### Stage 1 — Repair garbled text (mojibake)

**What it fixes:**
- UTF-8 text decoded as Windows-1252 or Latin-1, for example `Ã©` → `é`, `â€™` → `’`, `ä¸­æ–‡` → `中文`, `ðŸ˜€` → `😀`.
- Double or triple garbling, by repeating the repair until the text stops improving (maximum 3 passes).
- Byte order marks (BOM) inside the text, and doubled BOMs at the start of the file.
- The replacement character `�` (U+FFFD). This damage can't be undone, but it is flagged so the user knows data was already lost.

**How it works:** the repair reverses the wrong decoding step. It does not search and replace strings.

1. Find runs of characters that look like mis-decoded UTF-8: a lead character in À–ï or ð–ô, followed by characters that map back to UTF-8 continuation bytes in Windows-1252.
2. Re-encode the run as Windows-1252 bytes, then decode those bytes as strict UTF-8.
3. **Accept the repair only if it scores better.** The result must decode without errors, contain fewer suspicious characters, and must not turn ordinary letters into rare symbols.
4. A whole-file check runs as well. If most of the file is garbled, the fix is offered as one action: "This file looks like UTF-8 read as Windows-1252 — repair all".

**Safety rules:**
- Text that is already valid (`«CAFÉ»`, `naïve`, `Müller`) is never changed.
- Each repair is shown as a change with its reason, and the user can reject it.

### Stage 2 — Accents and special characters → plain ASCII

| Group | Examples | Default |
|---|---|---|
| Accented letters | `é→e`, `ñ→n`, `ü→u`, `Å→A` | On |
| Special letters | `ß→ss`, `Æ→AE`, `æ→ae`, `Ø→O`, `Œ→OE`, `Þ→Th`, `ł→l`, `đ→d` | On |
| Quotes and apostrophes | `‘ ’ ‚ ‛ ʼ → '`, `“ ” „ → "`, `« » → << >>` (or `"`) | On |
| Dashes and minus | `– — − → -` | On |
| Ellipsis | `… → ...` | On |
| Spaces | non-breaking, narrow, thin, em, ideographic → normal space | On |
| Invisible characters | zero-width space/joiner/non-joiner, word joiner, soft hyphen, direction marks, BOM, **Unicode tag characters (U+E0000–E007F)**, invisible math operators (U+2061–2064), combining grapheme joiner | On (remove) |
| Control characters | C0/C1 controls, **DEL (U+007F)** | On (remove); tab, LF and CR are kept |
| Symbols | `© → (c)`, `® → (R)`, `™ → (TM)`, `€ → EUR`, `° → deg`, `× → x` | On |
| Emoji | `😀 → :D` or remove | Off (user chooses) |
| Non-Latin scripts | Cyrillic, Greek, Chinese, Arabic… | **Transliterate** (`Москва → Moskva`) or **leave as is** — user choice; default is leave as is, with a suggestion to translate |
| Look-alike letters | Cyrillic `а` in `pаypal` | Flagged as a warning, with an optional fix |

**How it works:** Unicode normalization (NFD) strips the combining accent marks. Explicit tables handle letters that don't decompose (ß, Æ, Ø, ł…) and punctuation. A transliteration library handles non-Latin scripts.

Users who are signed in can add **custom rules**, for example `™ → TM`, `° → " degrees"`, or "keep `é` in this project".

### Stage 3 — Translate to English

- Detects the language per paragraph (or per cell for CSV/Excel). Text that is already English is skipped and not sent anywhere.
- **Short text is detected in context.** `franc` is unreliable on short text, so pieces under a configurable minimum length (start at ~20 characters, `LANG_DETECT_MIN_CHARS`) use the language of their column (CSV/Excel), or of their paragraph or whole document (plain text). Short ASCII-only pieces that look like names, codes or IDs are skipped.
- **"Language unclear" is never guessed.** If detection is undetermined, the piece is skipped and listed as "language unclear", with a **Translate anyway** option.
- Never sends numbers, emails, URLs, IDs or codes to the translator. These are masked with placeholders (`⟦1⟧`) before sending and restored after. **Every placeholder must come back exactly once and unchanged.** If one is missing, duplicated or altered, that result is rejected and the next provider is tried.
- Each translation is one change that replaces a whole paragraph or cell (see [section 13](#13-the-conversion-engine)).
- Runs on the server only (it needs an external service). The user sees a clear notice before anything is sent: "Translation sends this text to our server and a translation provider."
- Providers are card-free and interchangeable (see [section 15](#15-translation-service)).

---

## 6. How people use it — modes and accounts

### Processing modes

| | **Browser mode** (default) | **Cloud mode** |
|---|---|---|
| Where processing happens | User's device | Our server |
| Stage 1 + 2 | ✅ | ✅ |
| Stage 3 (translate) | Only the pieces that need translating are sent to the server, **after masking**, never the whole file. Everything else stays in the browser. Shown in a notice first | ✅ |
| File size | Up to what the device can handle (warn above 50 MB) | Up to plan limit (section 18) |
| Data uploaded | **Nothing** | File/text uploaded over HTTPS |
| Works offline after first load | ✅ | ❌ |

### Account levels

| | **Anonymous** (no login) | **Signed in** (free account) |
|---|---|---|
| Use the tool | ✅ | ✅ |
| Cloud processing | ✅ — files deleted **1 hour** after processing | ✅ |
| Save files and results | ❌ | ✅ — kept until the user deletes them (storage quota) |
| History of jobs | ❌ | ✅ |
| Custom replacement rules | ❌ (session only) | ✅ saved |
| Translation | Small daily quota | Larger daily quota |
| API keys | ❌ | ✅ |

---

## 7. Supported inputs and outputs

| Input | Read with | Output | Notes |
|---|---|---|---|
| Pasted text | — | Copy, or download `.txt` | |
| `.txt`, `.log`, `.md`, `.json`, `.xml`, `.sql` | Encoding detection, then text | Same format | Line endings preserved |
| `.csv`, `.tsv` | **Our own RFC 4180 tokenizer** (records each cell's exact byte range); Papa Parse only for delimiter detection | Same format, **written by splicing** | Only edited cells are rewritten; every other byte is copied unchanged, so delimiter, quoting, line endings and BOM are preserved. Same encoding as input or UTF-8 (user choice) |
| `.xlsx` | **ExcelJS** (read and write) | `.xlsx` | Only text cells change; **formulas, numbers, dates and styles are kept**. ExcelJS drops **charts and pivot tables**: these are detected on load and the user is warned before export |
| `.xls`, `.ods` | **SheetJS Community Edition**, read only (installed from `cdn.sheetjs.com`, not npm) | `.xlsx` (written with ExcelJS) | Values and formulas are kept; **styles are not**. The UI warns about this before export |
| `.accdb`, `.mdb` | **mdb-reader** | `.xlsx` via ExcelJS (one sheet per table, **real column names as the header row**, number/date types kept) | Clearly explained in the UI |
| `.docx` (v1.1) | mammoth / docx | `.txt` or `.docx` | Later phase |

**Encoding detection** is done on the whole file (or a safe window that never cuts a character in half):

- **BOM:** UTF-8, UTF-16 LE/BE, UTF-32.
- **UTF-16 without a BOM:** detected from the pattern of zero bytes.
- **Strict UTF-8:** validated over the whole file, and if it fails, our own detector picks between Windows-1252 (a superset of ISO-8859-1) and Shift-JIS (requires kana). Other legacy encodings (ISO-8859-2/5/7, KOI8-R…) are chosen by the user from a list (decision D9).
- The detected encoding and how confident the detection is are always shown to the user.

**Encoding on save (decided 2026-11-20):**

- **Default output encoding:** UTF-8 if Stage 1 made any accepted repairs; otherwise the same encoding as the input.
- Non-UTF-8 output (Windows-1252, ISO-8859-x, Shift-JIS, UTF-16…) is written with **`iconv-lite`**, because browsers and Node can only encode UTF-8 natively. In the browser it is **loaded lazily**, only when a non-UTF-8 save is chosen, if its bundle size is significant (measured in Phase 1/2).
- **If some characters won't fit** in the chosen encoding, the save is **blocked**. The user sees a list of those characters with their locations, and a **"Save as UTF-8 instead"** button. Characters are never silently replaced with `?`.

---

## 8. Pages and user flows

### Site map

```
/                         Home = the tool (paste box + drop zone + toggles)
/result/:jobId            Result view (before/after, per-change control, download)
/tools/fix-garbled-text   Single-purpose tool pages (same engine, preset toggles)
/tools/remove-accents
/tools/remove-invisible-characters
/tools/translate-to-english
/tools/csv-cleaner
/tools/excel-cleaner
/developers               API docs with live "try it"
/privacy                  What stays local, what is uploaded, retention
/login  /signup  /forgot-password
/app                      Dashboard (signed in)
/app/history              Past jobs
/app/files                Saved files
/app/rules                Custom replacement rules
/app/api-keys             Create / revoke keys, usage
/app/settings             Profile, default toggles, delete account
```

### Main flow (anonymous, browser mode)

1. The user lands on `/`, pastes text or drops a file.
2. The toggles show Stage 1 ✅, Stage 2 ☐, Stage 3 ☐, and mode **Browser**.
3. The user clicks **Clean**. Processing runs in a Web Worker and shows a progress bar.
4. The result view shows a split before/after panel with changes highlighted by type. A summary bar reads, for example, "42 encoding fixes · 118 accents · 3 invisible characters".
5. A changes panel lists every change grouped by type, with **Accept all / Reject all** per group, accept or reject per item, and a jump to the location (line, row/column, or cell).
6. The user clicks **Download** or **Copy**.

### Translation flow

1. The user turns on **Translate to English**. A notice appears: "Only the parts that need translating will be sent to our server and a translation provider, with numbers, emails, links and IDs hidden first. The rest of your file stays on your device." [Continue] [Cancel]. (In cloud mode, where the file is already on the server, the notice names the translation provider instead.)
2. The job runs in the cloud. The user sees the quota left today, for example "4,200 of 5,000 characters left today".
3. The result view adds a third column for the translation.

### Signed-in flow

Everything above, plus:

- **Save to my files** on the result page.
- Jobs appear in history.
- The user's own rules are applied automatically.

---

## 9. Design system

**Style:** minimal and calm, with lots of white space and one accent color. The tool is the hero of the page; there is no marketing clutter above it.

**Theme:** follows the operating system's light or dark setting, with a manual toggle (System / Light / Dark) saved per user.

### Color tokens (CSS variables, Tailwind theme)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAF9` | `#0C0C0D` | Page background |
| `--surface` | `#FFFFFF` | `#161618` | Cards, panels |
| `--border` | `#E7E5E4` | `#2A2A2E` | Dividers |
| `--text` | `#1C1917` | `#EDEDED` | Body text |
| `--muted` | `#78716C` | `#9A9AA0` | Secondary text |
| `--accent` | `#2563EB` | `#60A5FA` | Buttons, links, focus |
| `--fix-encoding` | `#D97706` | `#FBBF24` | Highlight: mojibake repairs |
| `--fix-accent` | `#7C3AED` | `#A78BFA` | Highlight: accent/ASCII changes |
| `--fix-invisible` | `#DC2626` | `#F87171` | Highlight: invisible/control chars |
| `--fix-translate` | `#059669` | `#34D399` | Highlight: translated text |

**Contrast (to fix in Phase 2).** All four highlight tokens and `--accent` are checked in both themes:
- Used as **highlight backgrounds** (tinted), the text on them must reach WCAG AA (4.5:1).
- Any of them used as **coloured text** must reach AA (4.5:1) against `--bg` and `--surface`.
- Known failures in the light theme on white: `--fix-encoding` `#D97706` (~3.2:1) and `--fix-translate` `#059669` (~3.8:1). **Fixed in Phase 2 (decision D12):** every type now has `--fix-X` (icons, underlines: ≥ 3:1), `--fix-X-text` (coloured text: ≥ 4.5:1 on `--bg`, `--surface` and its tint) and `--fix-X-bg` (tint: `--text` on it ≥ 4.5:1), plus a fifth type `--fix-safety` for formula guards. `apps/web/test/contrast.test.ts` measures every pair in both themes.

### Typography

- **UI:** Inter (or the system font stack).
- **Text panels:** JetBrains Mono. Invisible characters are drawn as visible markers such as `·NBSP·` and `⟨ZWSP⟩`.

### Components

- Drop zone + paste box (one component)
- Pipeline toggles (3 switches, with the mode selector)
- Diff viewer (virtualized for large files)
- Change list (grouped, filterable)
- Spreadsheet grid preview (virtualized)
- Toasts, modals, progress bar, quota meter

### Accessibility

- Works fully with a keyboard.
- Visible focus rings.
- Highlights never rely on color alone: each type also has an icon and a label.
- Screen-reader labels on all controls.
- Respects the user's reduced-motion setting.

---

## 10. Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[React app - Vite]
    W[Web Worker<br/>@cleanify/engine]
    UI <--> W
  end

  subgraph Cloudflare[Cloudflare edge - corrections 5 and 6]
    PF[Pages Function<br/>/api/* proxy]
    CW[Cron Worker<br/>R2 cleanup every 10 min]
  end

  subgraph Server[Node.js + Express API]
    API[REST API /api + /v1]
    Q[Job runner<br/>Agenda on MongoDB]
    E2[@cleanify/engine]
    T[Translation service<br/>provider chain]
    API --> Q --> E2
    Q --> T
  end

  DB[(MongoDB Atlas)]
  R2[(Cloudflare R2<br/>file storage)]
  CF[Cloudflare Workers AI<br/>translation]
  MM[MyMemory<br/>fallback translation]
  LT[LibreTranslate on<br/>Hugging Face Spaces<br/>2nd fallback]

  UI -- HTTPS JSON, same-site /api --> PF
  PF -- forwards --> API
  UI -- presigned upload/download --> R2
  CW -- delete expired anon/ and api/ objects --> R2
  API --> DB
  Q --> R2
  T --> CF
  T --> MM
  T --> LT
```

**Key principle: one engine, two places.** `@cleanify/engine` is a plain TypeScript package with no browser- or server-only code. The same code runs in the browser's Web Worker and in the server's job runner, so results are identical in both modes.

**Uploads go directly from the browser to R2** using short-lived presigned URLs. The API server never streams large files through itself, which keeps it light and works within free hosting limits.

**The API host is unreliable by design.** Render's free server sleeps after ~15 minutes idle, can restart at any time, and has ~512 MB RAM. So:
- Nothing that a privacy promise depends on runs only on Render. Expired-file deletion runs on a Cloudflare Cron Trigger Worker (correction 5, approved).
- Every Agenda job is **idempotent**: safe to run again after a crash or restart, part-way through.
- Large files are processed as streams where possible, to stay within the RAM limit.

**Cookies stay first-party (correction 6, approved).** `*.pages.dev` and `*.onrender.com` are different sites, so the browser won't send SameSite=Lax cookies from one to the other. A Cloudflare Pages Function proxies `/api/*` on the web origin to Render, so the browser only ever talks to one site. A custom domain (`example.com` + `api.example.com`) was considered and is not used for now.

---

## 11. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language; shared types between web, API and engine |
| Monorepo | **pnpm workspaces** + **Turborepo** | Shared engine package, fast builds |
| Frontend | **React 18 + Vite** | The "R" in MERN; fast dev server |
| Routing | React Router | |
| Styling | **Tailwind CSS** + CSS variables for themes | Easy light/dark tokens |
| UI primitives | Radix UI (headless) | Accessible dialogs, switches, menus |
| Server state | TanStack Query | Caching, retries |
| Big lists | TanStack Virtual | Large files and diffs |
| Backend | **Node.js 24 LTS + Express** | The "E" and "N" in MERN. Version pinned in `.nvmrc` and root `engines`; CI, Render and local dev all use it |
| Validation | **Zod** (shared schemas) | Same validation on client and server |
| Database | **MongoDB Atlas (M0 free)** + **Mongoose** | The "M" in MERN; free tier, no card |
| Background jobs | **Agenda** (stores jobs in MongoDB) | No Redis needed; stays pure MERN |
| File storage | **Cloudflare R2** (S3-compatible, via AWS SDK v3) | Free tier, no egress fees |
| Auth | JWT in **httpOnly cookies** (access + refresh), **argon2** password hashing, **Google OAuth** | Secure, standard |
| Email | Resend or Brevo free tier (verify card-free at setup) | Password reset, verification |
| CSV | **Own RFC 4180 tokenizer** in the engine; **Papa Parse** for delimiter detection and as a test oracle only | Papa Parse can't report cell positions and its writer picks its own quoting, so it can't give byte-identical round-trips |
| Excel (.xlsx) | **ExcelJS** | Reads and writes .xlsx keeping formulas, numbers, dates and styles (drops charts/pivots, which we detect and warn about) |
| Excel (.xls/.ods) | **SheetJS Community Edition**, read only, installed from `cdn.sheetjs.com` | The npm `xlsx` package is out of date; the free edition can't write styles, so it is never used for writing |
| Access | **mdb-reader** | Read .accdb/.mdb |
| Transliteration | **any-ascii** (decision D7), lazy-loaded | Non-Latin → Latin; best accuracy in our comparison |
| Encoding on save | **iconv-lite** (lazy-loaded in the browser if large) | Browsers and Node only encode UTF-8 natively |
| Language detection | `franc` (or `cld3-asm`) | Skip English, choose source language |
| Translation | Cloudflare Workers AI → MyMemory → self-hosted LibreTranslate | All card-free (section 15) |
| Testing | **Vitest** (unit), **Playwright** (end-to-end), **Supertest** (API) | |
| Lint/format | ESLint + Prettier | |
| CI | GitHub Actions | Tests on every push |

---

## 12. Repository structure

```
cleanify/
├── PROJECT.md                 ← this file
├── README.md                  ← setup and run instructions (written in Phase 1)
├── package.json               ← workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── .env.example
│
├── packages/
│   ├── engine/                ← @cleanify/engine (pure TS, no DOM, no Node APIs)
│   │   ├── src/
│   │   │   ├── decode/        ← encoding detection, BOM handling
│   │   │   ├── mojibake/      ← Stage 1 repair
│   │   │   ├── ascii/         ← Stage 2 tables + transliteration
│   │   │   ├── invisible/     ← invisible/control char catalogue
│   │   │   ├── formats/       ← text, csv (own tokenizer + splice writer), xlsx (ExcelJS),
│   │   │   │                     xls/ods (SheetJS read-only), access adapters
│   │   │   ├── changes/       ← Change model, apply/reject
│   │   │   └── index.ts
│   │   └── test/
│   │       └── fixtures/      ← real broken files (incl. the reference-tool bugs)
│   │
│   └── shared/                ← @cleanify/shared: Zod schemas, API types, constants
│
├── apps/
│   ├── web/                   ← React + Vite frontend
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── workers/       ← engine Web Worker
│   │   │   ├── theme/
│   │   │   └── api/
│   │   └── e2e/               ← Playwright tests
│   │
│   └── api/                   ← Express backend
│       ├── src/
│       │   ├── routes/
│       │   ├── models/        ← Mongoose models
│       │   ├── services/      ← storage (R2), translation, email
│       │   ├── jobs/          ← Agenda job definitions
│       │   ├── middleware/    ← auth, rate limit, errors
│       │   └── server.ts
│       └── test/
│
├── infra/
│   ├── libretranslate/        ← Dockerfile + README for the Hugging Face Space
│   └── cleanup-worker/        ← Cloudflare Cron Trigger Worker (correction 5)
│
│   (apps/web/functions/api/[[path]].ts ← Pages Function /api proxy, correction 6)
│
└── .github/workflows/ci.yml
```

---

## 13. The conversion engine

### Core idea: everything is a list of changes

The engine never edits text directly. It **produces a list of proposed changes**. The UI shows them, the user accepts or rejects them, and then the engine **applies the accepted ones**. This is what makes preview, undo and per-change control possible.

```ts
type Stage = 'encoding' | 'ascii' | 'invisible' | 'translate';

interface Change {
  id: string;
  stage: Stage;
  kind: string;               // e.g. 'mojibake', 'accent', 'nbsp', 'zwsp', 'tag-char', 'smart-quote'
  from: string;               // original text
  to: string;                 // proposed replacement ('' = remove)
  reason: string;             // human-readable explanation
  confidence: 'high' | 'medium' | 'low';
  anchor: Anchor;             // where the change applies (machine position, see below)
  location: Location;         // where to show it to the user (always in the ORIGINAL text)
  accepted: boolean;          // default true for high confidence
  dependsOn?: string[];       // ids of the changes this one builds on
}

// Machine position. Every position is stored against the ORIGINAL text,
// except a change that sits inside another change's output.
type Anchor =
  | { kind: 'original'; unit: string; start: number; end: number }
      // unit = text document, CSV cell id or sheet cell id; start/end are offsets
      // into that unit's ORIGINAL text (end exclusive)
  | { kind: 'inParent'; parentId: string; offsetInParent: number; length: number };
      // offsets into the parent change's `to` text; requires dependsOn to include parentId

type Location =
  | { type: 'text';  line: number; column: number; offset: number }
  | { type: 'csv';   row: number; column: number; header?: string; charPos: number }
  | { type: 'sheet'; sheet: string; cell: string; charPos: number };
```

**Columns are counted in user-visible characters (code points), and are 1-based.** This fixes the reference tool's column bugs.

### Positions (decided 2026-11-20)

- **Every position is stored against the original text.** Accepting or rejecting one change never moves the stored position of any other change.
- **A change inside another change's output** (for example `é→e` inside the output of `Ã©→é`) stores `{ parentId, offsetInParent }` instead of an original offset. It **must** list that parent in `dependsOn`; the engine rejects a change that breaks this rule.
- **Top-level changes never overlap** within a unit. The engine checks this when it builds the change list.
- **A translation change** is anchored to its whole unit's original range. Stage 1 changes inside the unit are its parents: their effect is already included in its `to`, so they are not applied again while the translation is accepted. Stage 2 changes on the English output are anchored `inParent` to the translation.
- **`applyChanges`** works one unit at a time:
  1. Take the accepted top-level changes and sort them by `start`, **highest first**.
  2. For each one, build its output: its `to` with its own accepted `inParent` children applied, also highest `offsetInParent` first (recursively).
  3. Splice that output into the original text at `start..end`. Because the work goes from the end towards the start, earlier offsets never shift.
- **`location`** (line/column, row/column, cell) is for display only and always points at the original text. For an `inParent` change it shows the parent's location.
- **Property tests (Phase 1, fast-check):**
  - Rejecting every change returns the original text exactly.
  - The result doesn't depend on the order the change list is given in.
  - Applying in reverse order gives the same result as applying one change at a time from the start while adjusting offsets by hand.
  - A rejected parent never leaves any of its children applied.
  - Random accept/reject sequences always end in a consistent state (no accepted child with a rejected parent).

### Dependent changes (`dependsOn`)

Changes from later stages can build on changes from earlier ones. Example: `Ã©→é` (encoding, id `c1`), then `é→e` (ascii, id `c2`, `dependsOn: ['c1']`).

- **Rejecting a parent automatically rejects its dependents** (rejecting `c1` also rejects `c2`, because the `é` it would change no longer exists).
- **Re-accepting the parent restores the dependents** to the state they had before they were auto-rejected. A dependent the user rejected by hand stays rejected.
- A dependent can't be accepted while its parent is rejected.
- **Rejecting a Stage 1 repair inside a translated unit** auto-rejects that unit's translation. The UI then shows **"Re-translate this paragraph"** (or "this cell"). Re-translation, and the quota it uses, happens **only when the user clicks it**. Re-accepting the repair restores the original translation without a new request.

### Translation changes

A translation change replaces a **whole unit**: one paragraph (text) or one cell (CSV/Excel). `from` is the unit's text after Stage 1, and `to` is the English. It has `dependsOn` pointing at any Stage 1 changes inside that unit. Stage 2 changes made on the English text have `dependsOn` pointing at the translation change.

### Public functions

```ts
detectEncoding(bytes: Uint8Array): EncodingResult
decode(bytes: Uint8Array, encoding?: string): DecodedDoc
analyze(doc: Doc, options: PipelineOptions): AnalysisResult      // Stage 1 + 2 proposals
applyChanges(doc: Doc, changes: Change[]): Doc
serialize(doc: Doc, format: OutputFormat): Uint8Array            // keeps structure, BOM, line endings
```

### Format adapters

Each format adapter turns a file into "text cells" with locations and back again, **without touching anything else**. For example, the CSV adapter keeps the delimiter, quoting and line endings, and the Excel adapter keeps formulas, numbers and styles.

**CSV adapter (own tokenizer + splicing).**
- A small RFC 4180 tokenizer records, for every cell, its exact start and end in the file, whether it was quoted, and the row and column.
- Output is written by **splicing**: only edited cells are rewritten, and every other byte is copied unchanged. With no accepted changes, output is byte-identical to input.
- An edited cell **keeps its original quoting**. An unquoted cell gets quotes only if the new value needs them (it contains the delimiter, a quote, CR or LF), with inner quotes doubled.
- Papa Parse is used only to detect the delimiter and, in tests, as an oracle: our tokenizer's cell values must match Papa Parse's on every fixture.
- An unterminated quote produces a warning with its line number (section 19 #17).

**Excel adapters.** `.xlsx` is read and written with ExcelJS; only string cells (including rich-text runs) are edited. `.xls`/`.ods` are read with SheetJS Community Edition and written as `.xlsx` with ExcelJS, with a "styles not kept" warning. Charts and pivot tables in `.xlsx` are detected on load (by looking for chart and pivot parts in the zip) and the user is warned that export will drop them.

---

## 14. Backend — API, data, storage

### REST endpoints (website API, cookie auth)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | — | Create account (email + password) |
| POST | `/api/auth/login` | — | Log in, sets httpOnly cookies |
| POST | `/api/auth/logout` | user | Clear session |
| POST | `/api/auth/refresh` | refresh cookie | New access token |
| GET | `/api/auth/google` / `/callback` | — | Google sign-in |
| POST | `/api/auth/forgot` / `/reset` | — | Password reset by email |
| GET | `/api/me` | user | Current user + quotas |
| POST | `/api/uploads` | optional | Get presigned R2 upload URL |
| POST | `/api/jobs` | optional | Start a cloud job (file key or text + options) |
| GET | `/api/jobs/:id` | owner | Status, progress, summary |
| GET | `/api/jobs/:id/changes` | owner | Paged list of proposed changes |
| POST | `/api/jobs/:id/apply` | owner | Apply accepted/rejected decisions, build output |
| GET | `/api/jobs/:id/download` | owner | Presigned R2 download URL |
| POST | `/api/translate` | optional | Translate a text snippet (quota-limited) |
| GET/POST/PATCH/DELETE | `/api/rules` | user | Custom replacement rules |
| GET/DELETE | `/api/files` | user | Saved files |
| GET | `/api/history` | user | Past jobs |
| GET/POST/DELETE | `/api/keys` | user | API keys |
| DELETE | `/api/me` | user | Delete account and all data |

Anonymous jobs are tied to a signed, anonymous session cookie, so only the person who created a job can see it.

### MongoDB collections (Mongoose models)

```ts
User        { _id, email, passwordHash?, googleId?, name, emailVerified,
              settings: { theme, defaultStages }, storageUsedBytes,
              createdAt, lastLoginAt }

Job         { _id, ownerId?, anonSessionId?, apiKeyId?, status: 'queued'|'running'|'done'|'failed'|'expired',
              input: { kind: 'text'|'file', r2Key?, fileName?, size?, format?, encoding? },
              options: PipelineOptions, progress, summary: { counts by kind },
              changesR2Key?, outputR2Key?, error?, expiresAt?, createdAt }
              // TTL index on expiresAt → anonymous jobs (1 h) and API-key jobs (24 h) auto-deleted

SavedFile   { _id, ownerId, jobId, name, r2Key, size, format, createdAt }

Rule        { _id, ownerId, name, from, to, isRegex: false, enabled, order, createdAt }

ApiKey      { _id, ownerId, name, prefix, hash, lastUsedAt, revokedAt?, createdAt }
              // only a hash is stored; the full key is shown once at creation

Usage       { _id, subject: userId|anonSessionId|apiKeyId, day: 'YYYY-MM-DD',
              translateChars, jobs, apiCalls }      // TTL after 90 days

TranslationCache { _id: sha256(provider+sourceLang+text), text, provider, createdAt }
              // TTL after 30 days
```

### File storage (Cloudflare R2)

- **Buckets:** `cleanify-uploads` (originals) and `cleanify-outputs` (results), both private.
- **Uploads and downloads** use presigned URLs that expire after 10 minutes.
- **Object key layout:** `anon/{sessionId}/{jobId}/...`, `users/{userId}/{jobId}/...`, or `api/{apiKeyId}/{jobId}/...`.
- **Anonymous files are deleted after 1 hour; API-key files after 24 hours.**
  - **Primary (correction 5, approved):** a **Cloudflare Cron Trigger Worker** runs every 10 minutes. It lists R2 objects under `anon/` and deletes those uploaded more than 1 hour ago, and under `api/` more than 24 hours ago. R2 listings include each object's upload time, so the Worker needs no database access. It runs on Cloudflare, so it keeps working while Render sleeps.
  - **Secondary:** the Agenda `cleanup-expired` job removes expired Job records and any leftover R2 objects when the API is awake. MongoDB's TTL index also removes expired Job records on its own.
  - **Safety net:** R2 lifecycle rules (which work in whole days) delete anything under `anon/` or `api/` older than 1 day.
  - Alternatives the owner may choose instead: a keep-awake ping to Render, or changing the promise to "deleted within 24 hours".
- **Signed-in users' files** stay until the user deletes them or the account is deleted.

### Background jobs (Agenda)

| Job | Trigger | What it does |
|---|---|---|
| `process-file` | New cloud job | Download from R2 → engine analyze → store changes JSON in R2 |
| `build-output` | User clicks apply | Apply decisions → serialize → upload output to R2 |
| `translate` | Job with Stage 3 | Chunk → provider chain → merge into changes |
| `cleanup-expired` | Every 10 min (only while the API is awake) | Delete expired anonymous and API-key jobs and any leftover R2 objects. Secondary to the Cron Worker |

**Every job is idempotent.** Render can restart at any time, so Agenda may run a job again after it was interrupted part-way. Each job checks what is already done before acting: for example, `process-file` overwrites the same changes key in R2 rather than appending, and `build-output` writes to a fixed output key. Re-running a finished job changes nothing.

---

## 15. Translation service

**Requirement:** card-free. No Anthropic key and no paid APIs.

### Provider chain

| Order | Provider | Why | Free allowance |
|---|---|---|---|
| 1 | **Cloudflare Workers AI** — translation model `@cf/meta/m2m100-1.2b` | Same Cloudflare account as R2; no card; ~100 languages | Daily free allocation (verify current limits at setup) |
| 2 | **MyMemory API** | No card, no signup needed; registering an email raises the limit | ~5k chars/day anonymous, ~50k with email (verify at setup). **The limit is per caller, and every request comes from our one server, so this is the total for ALL users combined**, not per user |
| 3 | **LibreTranslate, self-hosted on Hugging Face Spaces** (free CPU, Docker) | No card; open source; **no daily limit**, so it catches traffic once providers 1 and 2 run out | Unlimited requests, limited only by the Space's free CPU and memory (verify current specs at setup) |

Free-tier limits change. The exact numbers will be confirmed when accounts are created, and they live in config, not code.

**Capacity is sized around providers 1 and 3.** MyMemory is a small shared buffer for when Workers AI is briefly unavailable, not real capacity. Per-user quotas (section 18) are set from the Workers AI daily allowance plus what the LibreTranslate Space can handle.

### Why LibreTranslate is not on Vercel

Vercel runs short-lived functions. LibreTranslate is a Python server that must stay running with its models (~100 MB per language pair) loaded in memory. That exceeds Vercel's function size limits, and the models would reload on every cold start. Render's free tier (512 MB RAM) is also too small.

### LibreTranslate setup on Hugging Face Spaces

- A Docker Space using the official `libretranslate/libretranslate` image. The config lives in `infra/libretranslate/`.
- Only the languages we need are loaded (set with `LT_LOAD_ONLY`) to keep memory and startup time down.
- Protected with an API key (`LT_API_KEYS`), so only our backend can call it. The Space is set to private if the free tier allows; otherwise access is limited by the API key alone.
- **Free Spaces sleep after a period of inactivity.** The first request after sleeping is slow while it wakes up and loads models. The backend uses a longer timeout for this provider, and the UI shows "Translation server is waking up…".
- Text sent to this provider is processed on Hugging Face's servers. The privacy page says so.
- For local development, LibreTranslate can also run on the developer's PC with Docker.

### How it works

```ts
interface TranslationProvider {
  name: string;
  translate(texts: string[], sourceLang: string | 'auto'): Promise<string[]>;
  isAvailable(): Promise<boolean>;   // false when daily allowance is used up
}
```

1. **Split** the text into paragraphs, or cells for CSV and Excel.
2. **Detect language** per piece with `franc`:
   - Pieces of at least `LANG_DETECT_MIN_CHARS` (start at 20) are detected on their own.
   - Shorter pieces take the language of their column (CSV/Excel), or of their paragraph or the whole document (plain text).
   - Short ASCII-only pieces that look like names, codes or IDs are skipped.
   - Pieces that are English are skipped. Pieces where detection is undetermined are skipped and listed as **"language unclear"**, with a **Translate anyway** option.
3. **Mask** numbers, emails, URLs, codes and IDs with placeholders (`⟦1⟧`, `⟦2⟧`, …).
4. **Check the cache** in MongoDB (`TranslationCache`), since the same text is never translated twice.
5. **Send in batches** to provider 1. If it fails or the allowance is used up, try provider 2, then provider 3 (LibreTranslate). If all three fail, show a clear message: "Translation is unavailable right now — please try again later."
6. **Validate placeholders** in each result: every `⟦n⟧` sent must appear **exactly once and unchanged**, and no new ones may appear. If the check fails, that result is rejected and the piece is sent to the next provider. Only results that pass are cached.
7. **Unmask**: put the original numbers, emails and IDs back.
8. **Record usage** against the user, anonymous session or API key.

---

## 16. Public developer API

- **Base URL:** `https://api.<domain>/v1`
- **Auth:** header `Authorization: Bearer clf_live_xxxxxxxx`

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/clean` | Clean text synchronously (JSON in, JSON out) |
| POST | `/v1/jobs` | Start a file job (returns upload URL + job id) |
| GET | `/v1/jobs/:id` | Job status |
| GET | `/v1/jobs/:id/result` | Download URL for the cleaned file |
| POST | `/v1/translate` | Translate text to English |
| GET | `/v1/usage` | Today's usage and limits |

### Example

```bash
curl -X POST https://api.cleanify.example/v1/clean \
  -H "Authorization: Bearer clf_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"text":"CafÃ© â€“ donâ€™t","stages":{"encoding":true,"ascii":true}}'
```

```json
{
  "text": "Cafe - don't",
  "changes": [
    { "id": "c1", "stage": "encoding", "from": "Ã©", "to": "é", "location": { "line": 1, "column": 4 } },
    { "id": "c2", "stage": "ascii", "from": "é", "to": "e", "location": { "line": 1, "column": 4 }, "dependsOn": ["c1"] }
  ],
  "summary": { "encoding": 3, "ascii": 3, "invisible": 0 }
}
```

Errors use standard HTTP codes with `{ "error": { "code": "...", "message": "..." } }`. Rate-limit headers are included on every response.

---

## 17. Security and privacy

**Privacy promises (shown on `/privacy`):**

- In browser mode, **files never leave the device**.
- Anonymous cloud files are deleted after 1 hour.
- File contents are never used for anything except processing the user's own job. They are never logged and never used for training.
- Translation sends **only the text pieces that need translating, after masking** numbers, emails, URLs and IDs, **never the whole file**. In browser mode, everything else stays on the device. The privacy page and the translation notice use this exact wording. The privacy page names each translation provider (Cloudflare, MyMemory, Hugging Face for LibreTranslate).
- Users can delete their account and all files at any time.

**Security measures:**

| Area | Measure |
|---|---|
| Passwords | argon2id hashing; minimum length; breached-password check (optional) |
| Sessions | Short-lived JWT access token (15 min) + refresh token (7 days, rotated), httpOnly, Secure, SameSite=Lax cookies. Cookies must be first-party: the API is reached through the web origin (Pages Function `/api/*` proxy, correction 6) |
| CSRF | SameSite cookies + CSRF token on state-changing requests |
| API keys | Stored as SHA-256 hash; shown once; prefix for identification; revocable |
| Input | Zod validation on every request; file type checked by content (magic bytes), not just extension |
| Limits | Request size limits; rate limiting per IP / user / key (`express-rate-limit` with MongoDB store) |
| Files | Private R2 buckets; presigned URLs expire in 10 min; job ownership checked on every access |
| Headers | `helmet` (CSP, HSTS, etc.); CORS restricted to our web origin |
| Parsing safety | Excel/Access parsing in the job runner with time and memory limits; zip-bomb protection |
| Translation server | LibreTranslate Space requires our API key; key stored only in backend env vars |
| Secrets | Only in environment variables; `.env` never committed |
| Spreadsheet export | **Text** cells starting with `= + - @` (or tab/CR) are guarded against formula injection in CSV output (on by default). The guard is shown as **proposed changes** (stage `safety`, decision D8), so the user sees which cells change and can reject them. It is checked on the **final** cell value, after every accepted change (full-width `＝SUM` becomes `=SUM` in Stage 2 and is guarded; decision D11). It applies **only to text cells**: real numbers such as `-42` or `+1.5` are never changed. In `.xlsx`, real formulas are formulas, not text, and are left alone |
| Anonymous file deletion | Must not depend on the Render server being awake (it sleeps). Primary deletion runs on a Cloudflare Cron Worker (correction 5) |

---

## 18. Limits and quotas

Starting values. All of these live in config.

| Limit | Anonymous | Signed in | API key |
|---|---|---|---|
| Browser-mode file size | Device limit (warn > 50 MB) | Same | — |
| Cloud file size | 10 MB | 50 MB | 50 MB |
| Cloud jobs / day | 10 | 100 | 500 |
| Translation chars / day | 5,000 | 50,000 | 50,000 |
| Saved file storage | — | 200 MB | — |
| File retention | 1 hour | Until deleted | 24 hours |
| API requests / minute | — | — | 60 |

Translation limits are capped by what the free providers can handle in total. The system watches total daily use and lowers per-user limits automatically if providers are close to running out or the LibreTranslate Space is overloaded.

**MyMemory doesn't count toward these numbers.** Its free limit (~5k chars/day, ~50k with an email) is shared by every user, because all requests come from our server. The per-user translation quotas above are starting guesses and will be re-sized in Phase 4 from the real Workers AI daily allowance plus measured LibreTranslate throughput.

---

## 19. Lessons from the reference tool (bugs we must not repeat)

We audited an existing tool in this space by running its analysis code against crafted inputs. Each bug below becomes an **automated test** in `packages/engine/test/fixtures/`.

| # | Bug found | Cleanify requirement |
|---|---|---|
| 1 | Every quoted CSV field corrupted (`"Smith, John"` → `Smith, JohnSmith, John"`) | Own RFC 4180 tokenizer with exact cell positions + splice writer; round-trip test: parse → serialize must give identical bytes when no changes are accepted; edited quoted cells stay quoted; cell values checked against Papa Parse as an oracle |
| 2 | Last CSV row duplicated | Row-count tests, with and without a trailing newline |
| 3 | Excel cleaning drops formulas | ExcelJS read/write for `.xlsx`; only edit string cells; round-trip test for formulas, number formats, dates and styles; charts/pivots detected and warned about; `.xls`/`.ods` (SheetJS read-only) warn that styles aren't kept |
| 4 | Access export loses column names; numbers become text | Real column names as header; keep number/date types |
| 5 | DEL (U+007F) not detected | Included in control characters |
| 6 | Unicode tag characters (hidden text) reported as "legitimate" | Treated as invisible, high severity |
| 7 | Invisible math operators U+2061–2064, CGJ U+034F missed | In the invisible catalogue |
| 8 | Replacement character `�` not flagged | Flagged as "data already lost" |
| 9 | Doubled BOM silently hidden | Reported and removable |
| 10 | Look-alike letters (Cyrillic `а`) not flagged | Mixed-script warning |
| 11 | Real French `«CAFÉ»` flagged as mojibake; fix produced `ɻ` | Repair only accepted when the result scores better; French/German/Spanish text in "must not change" tests |
| 12 | Chinese mojibake split into pieces | Correct 3-byte sequence handling |
| 13 | Emoji mojibake split | Correct 4-byte sequence handling |
| 14 | Most common mojibake (`â€™`) got no fix | Windows-1252 reverse map covers `€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ` |
| 15 | CSV column numbers off by one / wrong after emoji | Columns counted in code points, 1-based, tested |
| 16 | UTF-16 without BOM read as UTF-8 | Zero-byte pattern detection |
| 17 | Unterminated CSV quote swallowed the file silently | Warning with the line number |
| 18 | Large-file encoding chosen from first 4 KB, could cut a character | Detection window never splits a character; low-confidence detection is reported |

---

## 20. Testing strategy

| Level | Tool | What |
|---|---|---|
| Engine unit tests | Vitest | Every mapping table, every mojibake pattern, every fixture in section 19 |
| "Must not change" tests | Vitest | Large samples of valid French, German, Spanish, Polish, Turkish, Chinese, Arabic text: Stage 1 must propose **zero** changes |
| Round-trip tests | Vitest | CSV: parse → splice-serialize with no changes = **identical bytes**; edited cells keep their quoting. Excel: formulas, number formats, dates and styles survive an ExcelJS round-trip |
| CSV oracle tests | Vitest | Our tokenizer's cell values match Papa Parse's on every CSV fixture |
| Change-model tests | Vitest | `dependsOn`: rejecting a parent rejects its dependents; re-accepting restores them; hand-rejected dependents stay rejected |
| Formula-guard tests | Vitest | Text cells starting with `= + - @` are guarded; real numbers (`-42`, `+1.5`) are never changed |
| Property tests | fast-check | Random Unicode strings: encode-as-1252-then-repair returns the original |
| Translation tests | Vitest | Each provider mocked; fallback order 1 → 2 → 3; masking restores numbers/emails/URLs exactly; a result with a missing, duplicated or altered `⟦n⟧` is rejected and falls through to the next provider; short-text detection uses column/document context; undetermined → "language unclear"; slow-wake timeout for LibreTranslate |
| Cleanup tests | Vitest (Worker logic with a mocked R2 listing) | `anon/` objects older than 1 h and `api/` older than 24 h deleted; newer ones and `users/` never touched |
| API tests | Vitest + Supertest + in-memory MongoDB | Auth, jobs, quotas, ownership checks |
| End-to-end | Playwright | Paste → clean → download; file upload; translation flow; dark/light themes |
| Accessibility | axe-core in Playwright | No serious violations on main pages |
| CI | GitHub Actions | All of the above on every push; main branch must stay green |

**Phase 1 target:** the engine has 90%+ test coverage before any UI work starts.

---

## 21. Deployment and environments

All hosting is **card-free free tiers**. Each one will be confirmed as card-free when the accounts are created.

| Part | Host | Notes |
|---|---|---|
| Frontend | **Cloudflare Pages** | Same Cloudflare account as R2 and Workers AI. A Pages Function proxies `/api/*` to Render so cookies stay first-party (correction 6). No custom domain for now |
| API + job runner | **Render free web service** (alternatives: Koyeb, Railway trial) | Sleeps after ~15 min idle (first request after a pause is slow), can restart at any time, ~512 MB RAM. Acceptable for launch because nothing promise-critical runs only here and all jobs are idempotent. Runs **Node 24** (reads `.nvmrc`, or set `NODE_VERSION=24`) |
| File cleanup | **Cloudflare Cron Trigger Worker** (correction 5) | Every 10 min; deletes expired `anon/` and `api/` objects in R2 |
| Database | **MongoDB Atlas M0** | 512 MB free |
| Files | **Cloudflare R2** | Free tier storage and operations. **R2 may ask for a payment method when it is turned on**, which would break the card-free rule. Checked in Phase 0 before anything depends on it |
| Translation | **Cloudflare Workers AI** → **MyMemory** → **LibreTranslate on Hugging Face Spaces** | LibreTranslate Space sleeps when idle; first request after sleep is slow |
| Email | Resend / Brevo free tier | |
| Domain | Optional (`*.pages.dev` works for free) | |

**Not used:** Vercel can't host LibreTranslate (see section 15). The frontend could run on Vercel, but Cloudflare Pages keeps everything in one account.

**Environments:** `local` (dev machine, local or Atlas DB, optional local LibreTranslate in Docker), `preview` (each pull request on Pages), and `production`.

### Environment variables (`.env.example`)

```
# API
NODE_ENV=development
PORT=4000
APP_NAME=Cleanify
WEB_ORIGIN=http://localhost:5173
MONGODB_URI=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
ANON_SESSION_SECRET=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_UPLOADS=cleanify-uploads
R2_BUCKET_OUTPUTS=cleanify-outputs

# Retention (config, not code)
ANON_RETENTION_MINUTES=60
API_RETENTION_HOURS=24

# Translation
CF_ACCOUNT_ID=
CF_AI_API_TOKEN=
MYMEMORY_EMAIL=
LIBRETRANSLATE_URL=            # e.g. https://<user>-<space>.hf.space (or http://localhost:5000 locally)
LIBRETRANSLATE_API_KEY=
TRANSLATION_PROVIDERS=cloudflare,mymemory,libretranslate   # order of the fallback chain
LANG_DETECT_MIN_CHARS=20       # shorter pieces use column/paragraph/document-level detection

# Email
EMAIL_API_KEY=
EMAIL_FROM=

# Web (Vite)
# The browser always calls same-origin /api/* (correction 6).
# Dev only: where the Vite dev server forwards /api/*.
API_PROXY_TARGET=http://localhost:4000
VITE_APP_NAME=Cleanify

# Pages Function proxy (only if correction 6 = proxy; set in the Pages dashboard, not .env)
# API_ORIGIN=https://<service>.onrender.com
```

The cleanup Worker (correction 5) gets its R2 bucket through a Wrangler binding in `infra/cleanup-worker/wrangler.toml`, not through access keys. Its retention values are Worker variables matching `ANON_RETENTION_MINUTES` and `API_RETENTION_HOURS`.

---

## 22. How we will build it — team and workflow

### Team

| Role | Who | Responsibility |
|---|---|---|
| Project owner / product decisions | **Bipin** | Approves the plan and each phase, tests features, creates the external accounts (Cloudflare, Atlas, Render, Google, Hugging Face) |
| Engineer | **Claude Code** | Writes code, tests and docs; proposes designs; reports results honestly, including failing tests |

### Working rules

1. **No coding until the owner says "start".** Each phase also needs approval before it begins.
2. **One phase at a time.** Each phase ends with something that runs, a short demo note, and passing tests.
3. **Git:** `main` is always working. Each phase or feature is built on its own branch and merged after the owner reviews it.
4. **Decisions** that change this plan are written back into this file (see the decision log below).
5. **Secrets** are created by the owner and stored only in `.env` files or the hosting dashboards, never in chat or in git.

### Decision log

| Date | Decision |
|---|---|
| 2026-11-20 | Name: **Cleanify** (renameable via config) |
| 2026-11-20 | Pipeline: mojibake repair → accents/ASCII → translate to English; both ASCII and real translation are supported |
| 2026-11-20 | Processing: browser by default; cloud optional; anonymous use allowed (iLovePDF-style); accounts add storage/history/rules/API |
| 2026-11-20 | Audience: all users; plain wording, advanced features available |
| 2026-11-20 | Design: minimal; adapts to light/dark |
| 2026-11-20 | Stack: MERN (MongoDB, Express, React, Node) in TypeScript |
| 2026-11-20 | File storage: Cloudflare R2 |
| 2026-11-20 | Everything card-free; no Anthropic or paid APIs |
| 2026-11-20 | Translation chain: Cloudflare Workers AI → MyMemory → LibreTranslate self-hosted on Hugging Face Spaces (not Vercel: serverless can't run it) |
| 2026-11-20 | **C1** Excel: ExcelJS reads/writes `.xlsx` (keeps formulas, numbers, dates, styles). SheetJS CE from `cdn.sheetjs.com` (not npm) only reads `.xls`/`.ods`; output `.xlsx` with a "styles not kept" warning. Charts/pivots detected on load and warned about before export |
| 2026-11-20 | **C2** CSV: own RFC 4180 tokenizer recording cell positions; splice writer (only edited cells rewritten, original quoting kept). Papa Parse only for delimiter detection and as a test oracle |
| 2026-11-20 | **C3** Run order is Stage 1 → Stage 3 (translate, optional) → Stage 2 (ASCII on the English output). Stage numbers kept as names |
| 2026-11-20 | **C4** `Change.dependsOn?: string[]`; rejecting a parent rejects dependents, re-accepting restores them. Translation changes replace a whole paragraph/cell |
| 2026-11-20 | **C5 — Approved by owner 2026-11-20:** Cloudflare Cron Trigger Worker (every 10 min) deletes `anon/` > 1 h and `api/` > 24 h from R2; Agenda cleanup secondary; all Agenda jobs idempotent; new `api/{apiKeyId}/{jobId}/` prefix and 24 h TTL on API-key jobs. Alternatives rejected: keep-awake ping, promise "within 24 hours" |
| 2026-11-20 | **C6 — Approved by owner 2026-11-20:** Cloudflare Pages Function proxies `/api/*` to Render so cookies stay first-party. No custom domain for now |
| 2026-11-20 | **C7** MyMemory's free limit is per caller = total for all users; quotas sized around Workers AI + LibreTranslate |
| 2026-11-20 | **C8** Language detection: pieces under `LANG_DETECT_MIN_CHARS` (20) use column/paragraph/document context; short name/code/ID-like ASCII skipped; undetermined → "language unclear" + "translate anyway" |
| 2026-11-20 | **C9** Every `⟦n⟧` placeholder must survive exactly once and unchanged; otherwise reject that result and try the next provider |
| 2026-11-20 | **C10** Formula-injection guard applies only to text cells; real numbers like `-42` are never changed |
| 2026-11-20 | **C11** R2 may require a payment method on activation; checked in Phase 0 (risk in section 24) |
| 2026-11-20 | **D1** Encoding on save: iconv-lite for non-UTF-8 output (lazy-loaded in the browser if large). Characters that don't fit → save blocked, list with locations, "Save as UTF-8 instead". Default: UTF-8 if Stage 1 made repairs, else same as input (section 7) |
| 2026-11-20 | **D2** Rejecting a repair inside a translated unit auto-rejects the translation and shows "Re-translate this paragraph"; quota is used only when the user clicks it (section 13) |
| 2026-11-20 | **D3** Positions: every anchor is against the ORIGINAL text; changes inside another change's output use `{ parentId, offsetInParent }` and must list the parent in `dependsOn`; `applyChanges` applies accepted changes in reverse offset order. Covered by property tests in Phase 1 (section 13) |
| 2026-11-20 | **D4** Translation in browser mode sends only the pieces needing translation, after masking, never the whole file; the privacy page and notice say exactly this (sections 6, 8, 17) |
| 2026-11-20 | **D5** Contrast: all four highlight tokens and `--accent` checked in both themes in Phase 2; backgrounds and coloured text must pass AA (section 9) |
| 2026-11-20 | **D6** Agenda's maintenance checked before Phase 3; any switch to an alternative needs owner approval (section 24) |
| 2026-11-20 | **P0-1** The web app always calls same-origin `/api/*`: Vite dev proxy locally, Pages Function in production. `VITE_API_URL` replaced by dev-only `API_PROXY_TARGET` (section 21) |
| 2026-11-20 | **P0-2** TypeScript pinned to 6.0.x: typescript-eslint 8.73 supports TypeScript <6.1, and npm "latest" is 7.0. Revisit when typescript-eslint supports 7 |
| 2026-11-20 | **P0-3** Tooling versions: Express 5, Vite 8, Tailwind CSS 4 (CSS-first `@theme` mapped to the section 9 variables), Vitest 5, pnpm 12 via Corepack. Added an `--on-accent` token (white / `#0C0C0D`) for text on accent buttons |
| 2026-11-20 | **P0-4** Node.js **24 LTS everywhere** (was "20+"): `.nvmrc` = `24`, root `engines` = `>=24 <25`, CI reads `.nvmrc`, `@types/node` ^24, API bundle targets `node24`. Render must be set to Node 24 too (section 21) |
| 2026-11-20 | **P0-5** Repo uses a repo-local git identity (owner's); history rewritten before the first push. Remote: `github.com/bpin007/cleanify`. The owner merges PRs on GitHub after green CI and review |
| 2026-11-22 | **D7** Transliteration library: **any-ascii** (ISC, 0 deps), chosen over `transliteration` after testing both on 13 samples: correct symbols (€→EUR, ™→TM), Greek, Hepburn Japanese, emoji shortcodes; 2.4× faster; CJK comes out without spaces. 219 KB gzipped, so it is **loaded lazily** (`loadTransliterator()`) only when the user turns transliteration on (section 11) |
| 2026-11-22 | **D8** CSV formula-injection guard is shown as **proposed changes** (stage `safety`, kind `formula-guard`, accepted by default) instead of being applied silently at export, so the user sees it and the byte-identical round-trip holds when everything is rejected. Real numbers (`-42`, `+1.5`) are never guarded (sections 13, 17) |
| 2026-11-22 | **D9** Encoding detection: own detector (BOMs, UTF-16 zero pattern, strict UTF-8, Windows-1252 vs Shift-JIS with kana check), no jschardet. Low-confidence guesses are flagged and the user can pick the encoding manually. Other ISO-8859 variants are read as Windows-1252 unless chosen by hand; revisit if real files need more (section 7) |
| 2026-11-22 | **D10** Engine details decided in Phase 1 (engineer; owner may override): warnings (data lost, hidden text, bidi controls, look-alikes) are reported **whatever the stage toggles are**, since they never change text; emoji are handled as whole sequences (ZWJ, skin tones, flag tags kept intact); ZWJ/ZWNJ inside non-Latin words (Persian, Indic) are kept; look-alike fixes are proposed but not accepted by default; non-UTF-8 output: Windows-1252 and UTF-16/32 are written natively, other encodings through a pluggable encoder (iconv-lite in Phase 2) |
| 2026-11-22 | **D11** Phase 1 review fixes (owner): (1) the CSV formula guard is an apostrophe **insertion** proposed for every cell that could start with `= + - @` (tab/CR) in the output (as it is, with the default decisions, or with every change accepted); it is inserted only if the cell's **final** value really is a formula risk, and `applyChanges` reports cells that still are one (e.g. guard rejected). (2) Ambiguous Stage 1 pairs, a real capital such as `Ä`/`Å`/`Ç` (not `Ã`/`Â`) followed by punctuation (`Ä…` = Polish `ą` or German `Ä` + `…`), are **medium** confidence and auto-accepted only when the same file has other high-confidence mojibake repairs; repairs to Windows-1252 typographic characters (`Å“` → `œ`) stay high (section 19 #14). (3) When the ASCII stage is on, `applyChanges` returns a report of characters that are still not ASCII with their locations in the output, for the UI's "N characters are still not ASCII" warning (`checkOutput` does the same for any document) |
| 2026-11-23 | **D12** Colour contrast (section 9): light text variants `--fix-encoding-text` `#92400E` (6.8:1 on `--bg`), `--fix-translate-text` `#065F46`, `--fix-accent-text` `#6D28D9`, `--fix-invisible-text` `#B91C1C`, `--accent-text` `#1D4ED8`; solid tint tokens per type; new `--fix-safety` (cyan) for formula guards. The plan's base colours stay for non-text marks. Highlights also differ by underline style (solid, dotted, dashed, double) so they never rely on colour alone |
| 2026-11-23 | **D13** Phase 2 UI details (engineer; owner may override at the checkpoint): **React Router 7** (v8 needs React 19, the plan pins React 18); fonts are **self-hosted** via Fontsource, not Google Fonts, so browser mode makes no third-party requests; the Translate switch and Cloud mode are shown **disabled, marked "coming soon"** until Phases 3–4; browser-mode results live at `/result/local`, in memory only (a reload shows "nothing to show"); the engine runs in an ES-module Web Worker so any-ascii stays a lazy chunk; Excel/Access files are refused with a "coming soon" message until their adapters land later in Phase 2; the engine gained `preview()` (marks and edits for the diff) and an `onProgress` hook |

---

## 23. Roadmap and phases

### Phase 0 — Setup (owner + Claude)
- Create the project folder and git repository, and set up the monorepo skeleton, lint, formatting and CI.
- Owner creates accounts: GitHub, Cloudflare (R2 + Workers AI + Pages), MongoDB Atlas, Render, Google OAuth, Hugging Face.
- **Card-free checks:** does turning on R2 ask for a payment method? Does Workers AI still offer `@cf/meta/m2m100-1.2b`, and what is its daily free allowance? What is MyMemory's current free limit (with and without an email)? Results recorded in sections 15, 21 and 24.
- Corrections 5 (file cleanup) and 6 (proxy) approved by owner on 2026-11-20.
- **Done when:** `pnpm dev` starts empty web and API apps, and CI runs.

### Phase 1 — Conversion engine
- Encoding detection and decoding (all cases in section 7).
- Stage 1 mojibake repair with scoring.
- Stage 2 ASCII tables, invisible/control catalogue, transliteration.
- Change model with `dependsOn`, `applyChanges`, and format adapters for text and CSV (own RFC 4180 tokenizer + splice writer; Papa Parse for delimiter detection and as a test oracle).
- Formula-injection guard for CSV export (text cells only).
- All section 19 fixtures and the "must not change" corpus. **Each section 19 bug is written as a failing test first, then made to pass.**
- **Done when:** all engine tests pass, coverage is 90% or higher, and CSV round-trips are byte-identical.

### Phase 2 — Website, browser mode
- Design system, light/dark themes, layout.
- Home tool: paste and drop, toggles, Web Worker processing, progress bar.
- Result view: diff, change list, accept/reject, download/copy.
- Excel and Access adapters (browser): ExcelJS for `.xlsx` read/write; SheetJS CE (from `cdn.sheetjs.com`) read-only for `.xls`/`.ods` with a "styles not kept" warning; chart/pivot detection with a warning before export; mdb-reader for Access, exported via ExcelJS.
- Tool pages and the privacy page.
- **Done when:** a user can clean text, CSV and Excel fully in the browser; Playwright tests pass; accessibility checks pass.

### Phase 3 — Backend: accounts and cloud mode
- Express API, MongoDB models, authentication (email + Google), anonymous sessions.
- R2 presigned uploads and downloads (`anon/`, `users/`, `api/` prefixes), idempotent Agenda jobs, secondary cleanup job.
- File cleanup (correction 5): Cloudflare Cron Trigger Worker in `infra/cleanup-worker/`, Agenda as secondary, R2 1-day rule as safety net.
- First-party cookies (correction 6): Pages Function `/api/*` proxy in `apps/web/functions/`.
- Cloud mode in the UI; dashboard (history, files, rules, settings).
- **Done when:** anonymous cloud jobs work and expire after 1 hour, **even while the Render server is asleep**; login works on the deployed preview (not just localhost); signed-in users can save files and rules; API tests pass.

### Phase 4 — Translation
- Provider interface, Cloudflare Workers AI and MyMemory providers, fallback, masking with placeholder validation, caching, quotas (re-sized from real Workers AI + LibreTranslate capacity; MyMemory treated as a small shared buffer).
- Language detection with short-text context rules, "language unclear" list and "translate anyway".
- Deploy LibreTranslate to a Hugging Face Space (Docker, API key, chosen languages only) and add it as the third provider.
- Translation toggle, notice, "waking up" state and third result column in the UI.
- **Done when:** mixed-language text and CSV translate correctly; limits are enforced; fallback 1 → 2 → 3 is tested.

### Phase 5 — Developer API
- API keys (create, revoke), `/v1` endpoints, rate limits, usage tracking.
- `/developers` docs page with a live "try it".
- **Done when:** documented curl examples work end to end.

### Phase 6 — Launch
- Deploy to Cloudflare Pages + Render + Atlas, with the LibreTranslate Space on Hugging Face.
- Error monitoring (Sentry free tier) and basic analytics that don't track users.
- Final security review, privacy page review, launch checklist.

### Later (version 1.1+)
- `.docx` support, a browser extension, more output languages, team workspaces, paid plans.

---

## 24. Risks and open questions

| Risk / question | Impact | Plan |
|---|---|---|
| Free translation limits are small | Translation runs out on busy days | Cache, skip English, mask non-text, per-user quotas; LibreTranslate (no daily limit) as last fallback |
| MyMemory's limit is shared by all users (one server = one caller) | Provider 2 gives ~5k–50k chars/day **in total**, not per user | Treated as a small buffer only; quotas sized around Workers AI + LibreTranslate |
| **R2 may ask for a payment method on activation** | Breaks the card-free rule; file storage and cloud mode depend on it | Check in Phase 0 before building on it. If it does, owner decides: accept, or switch storage (e.g. MongoDB GridFS with tighter size limits, or another S3-compatible card-free host) |
| Render restarts at any time and has ~512 MB RAM | Interrupted jobs; large files run out of memory | Idempotent jobs; stream large files; cloud file limits (section 18) kept within RAM |
| Render sleeping breaks the 1-hour delete promise | Privacy promise broken | Correction 5: Cron Worker on Cloudflare (approved) |
| Pages Function proxy (correction 6) adds an **extra network hop**, and every `/api/*` call counts against the **Workers free plan's daily request limit** (Pages Functions are billed as Workers; the exact limit is checked at setup) | Extra latency on every API call; the API stops working for the rest of the day if the limit is hit | Uploads/downloads go straight to R2, not through the proxy; the browser-mode tool makes no API calls at all; watch daily usage; a custom domain (no proxy) is the fallback if limits become a problem |
| ExcelJS drops charts and pivot tables | User loses parts of their workbook | Detect on load, warn before export |
| SheetJS CE comes from `cdn.sheetjs.com`, not npm | Install is a tarball URL, not a normal registry dependency | Pin the exact tarball version and its integrity hash in the lockfile |
| LibreTranslate Space sleeps or is slow on free CPU | Slow translations when providers 1–2 are exhausted | Longer timeout, "waking up" message, load only needed languages; move to a bigger host if traffic grows |
| Hugging Face changes free Space terms | Third provider could stop being free | It's behind the provider interface; app keeps working with providers 1–2 |
| Free-tier terms change (card requirements, limits) | Hosting or translation could stop being free | Providers behind interfaces; config-driven limits; check terms at setup |
| Render free instances sleep | First request is slow (cold start) | Show "waking up server…"; browser mode doesn't need the server at all |
| m2m100 / LibreTranslate quality lower than DeepL/Google | Some translations are clunky | Shown clearly as "machine translation"; providers can be swapped later |
| Mojibake false positives | Wrong "fixes" damage valid text | Scoring + large "must not change" test corpus + user preview |
| Very large files in the browser | Tab may run out of memory | Streaming parse, virtualized views, warnings, suggest cloud mode |
| Name "Cleanify" may be taken | Domain/brand conflict | Name lives in config; check domains before launch; alternatives: Textwash, Unmangle, Plainly |
| ~~Open: transliteration library choice~~ | — | Decided: any-ascii (D7) |
| **Known limit (Phase 1):** ambiguous garbled pairs such as `Ä…` | It is both Polish `ą` garbled and a real German `Ä` followed by `…` | Medium confidence; auto-accepted only when the same file has other clear repairs (D11), otherwise shown unaccepted with a reason. A Polish file whose only damage is isolated `Ä…` pairs needs the user to accept them |
| **Known limit (Phase 1):** a single garbled non-Latin letter in otherwise Latin text | Not repaired unless that script already appears in the text (avoids false repairs like `Ï…` → `υ`) | Whole-file mojibake warning still points users at the problem; revisit if real files show this |
| **Known limit (Phase 1):** rejecting a Stage 1 repair leaves the garbled characters as they are | Stage 2 doesn't convert them (its changes for that spot sat inside the rejected repair) | Acceptable: the user chose to keep that text. A "re-analyse with my decisions" action can be added in Phase 2 if needed |
| **Open:** email provider | — | Pick a card-free one in Phase 3 |
| **Open:** which languages LibreTranslate loads | — | Decide in Phase 4 based on expected users (more languages = more memory) |
| **Open:** is Agenda still maintained? | An abandoned job library is a long-term liability | Check before Phase 3. If abandoned, propose a maintained fork or a small Mongo-backed job collection with polling, and **ask the owner before switching** |
| **Open:** iconv-lite browser bundle size | Could slow the first page load | Measure; lazy-load only when a non-UTF-8 save is chosen if it is significant |
| **Open:** Workers AI still offers `m2m100-1.2b`? Daily free allowance? | Provider 1 may be gone or smaller | Check in Phase 0 |

---

## 25. Glossary

| Term | Meaning |
|---|---|
| **Mojibake** | Garbled text caused by decoding bytes with the wrong character encoding, e.g. `Ã©` instead of `é` |
| **Encoding** | The rule for turning bytes into characters (UTF-8, Windows-1252, UTF-16…) |
| **UTF-8** | The standard encoding of the web; one to four bytes per character |
| **Windows-1252** | An old Western-European encoding; mixing it up with UTF-8 causes most mojibake |
| **BOM** | Byte Order Mark; an invisible marker at the start of some files (U+FEFF) |
| **ASCII** | The basic 128 characters (A–Z, 0–9, basic punctuation) that every system accepts |
| **Transliteration** | Writing one script in another, e.g. `Москва → Moskva` |
| **Code point** | One Unicode character number, e.g. U+00E9 for `é` |
| **NBSP** | Non-breaking space; looks like a space but isn't one |
| **Zero-width characters** | Characters with no visible width (ZWSP, ZWJ, ZWNJ, word joiner) |
| **Tag characters** | Invisible Unicode characters (U+E0000–E007F) that can hide text |
| **Presigned URL** | A short-lived link that lets the browser upload or download one file directly to or from storage |
| **LibreTranslate** | Open-source, self-hostable machine translation server |
| **Hugging Face Spaces** | Free hosting for apps and Docker containers, used here to run LibreTranslate |
| **MERN** | MongoDB, Express, React, Node.js |
