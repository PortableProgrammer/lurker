# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What lurker is

Self-hosted, read-only Reddit client. Fork of [oppiliappan/lurker](https://github.com/oppiliappan/lurker). The user-facing pitch lives in [readme.md](readme.md); this file is for orientation as a contributor.

This fork **does not contribute upstream**. We may cherry-pick from upstream PRs (see [Issue #35](https://github.com/PortableProgrammer/lurker/issues/35) referencing upstream PR #36 for OIDC); we never PR back.

## Runtime

**Bun, not Node.** This matters more than it looks: SQLite is `bun:sqlite`, password hashing is `Bun.password`, the JWT secret is generated via `Bun.CryptoHasher`. There is no `npm`. Use `bun install`, `bun run <file>`, `bunx <tool>`.

Dependencies in [package.json](package.json):
- Express 5 (migrated in `e26d0b8`; the `{*url}` syntax in route definitions is Express 5, not a typo)
- Pug for views
- `he` for HTML entity decoding (applied liberally; see "Data flow" below)
- `jsonwebtoken` for auth cookies
- `express-rate-limit` (100 req / 15min, IP-scoped)

## Common commands

| Action | Command |
|---|---|
| Run dev server | `bun run src/index.js` |
| Lint | `bunx @biomejs/biome check src/` |
| Format | `bunx @biomejs/biome format --write src/` |
| Build (precompile pug) | `bun build.js` — but see note below |
| Test | *No test suite exists.* |

**`build.js` is effectively dead code.** It precompiles pug templates to `dist/`, but the Dockerfile and runtime serve directly from `src/views/` via Express's pug view engine. Don't rely on `dist/` at runtime.

## Environment variables

- `LURKER_PORT` — listen port, default `3000`
- `LURKER_TRUST_PROXY` — set truthy to enable Express `trust proxy`
- `LURKER_PROXY_COUNT` — number of trusted proxy hops, default `1` (only meaningful when `LURKER_TRUST_PROXY` is set)

## DevContainer

Project is developed in a VS Code DevContainer ([.devcontainer/devcontainer.json](.devcontainer/devcontainer.json)) built from the production [Dockerfile](Dockerfile) with the Bun, Git, and SQLite features added. Routing rule (from global CLAUDE.md): **run `bun install` / build steps inside the container; read-only ops can run anywhere.**

[.devcontainer/init/init.sql](.devcontainer/init/init.sql) is **commented-out** helper SQL for seeding a debug admin (`debug`/`test`), toggling prefs, and subscribing to a working set of subreddits. It is **not auto-executed**; uncomment and run via the SQLite extension when needed for local repro.

Port forwarding for mobile testing: see the `socat` recipe at the bottom of [readme.md](readme.md).

## Architecture

```
src/
├── index.js       # Express app entry. JWT_KEY generated here; exported for auth.js
├── routes/
│   └── index.js   # ALL routes in one file (~1000 lines). Helpers appended after module.exports.
├── auth.js        # authenticateToken / authenticateAdmin middlewares
├── invite.js      # validateInviteToken middleware (first user auto-admins)
├── db.js          # SQLite schema + forward-only migrations table
├── geddit.js      # Reddit API client (20+ async methods)
├── extlinks.js    # External-domain → inline-media transformation pipeline
├── views/         # Pug page templates
├── mixins/        # Pug mixins (post, comment, postUtils, etc.)
├── public/        # Served as static: styles.css, web manifest, JS
└── assets/        # Served as static: icons, snoo SVGs
```

### Request flow (typical)

1. Request hits `src/index.js` → rate limiter → routes router
2. `src/routes/index.js` handler runs `authenticateToken` (cookie JWT verify → redirect to `/login` on fail)
3. Handler calls a `geddit.js` method (returns parsed JSON from reddit.com)
4. Reddit data is run through `unescape_submission` / `unescape_comment` / `unescape_media_embed` helpers — these `he.decode()` HTML entities **before** the template renders them
5. For `prefs.view === 'card'`, `ExtLinks.resolveExternalLinks` walks each post (and recursively each comment tree) to fetch + transform external links (xkcd, imgur, reddit media) into rich previews
6. Template renders via Pug; static assets served from `public/` and `assets/`

### ExtLinks pipeline — the unusual part

[src/extlinks.js](src/extlinks.js) is the centerpiece of the "make selftext readable" experience. Each known domain in `ExternalDomains` declares:

- `expression` — domain match regex
- `should_fetch` — whether to fetch the URL server-side for additional metadata
- `post_only` — whether it can replace inline comment/selftext links or only top-level post URLs
- `link_data` / `post_data` / `inline_replacement` — transformations

The pipeline has three entry points: `parseExternalLink` (URL → data), `parseExternalPost` (post object → enriched post data), `resolveExternalInlineLinks` (HTML body → HTML with inline media injected). Comment-tree resolution uses `Promise.all` across the tree.

**Failure modes worth knowing**: slow imgur fetches can block page render; an unsupported external link currently produces a broken preview rather than gracefully falling back to a link post (see [Issue #34](https://github.com/PortableProgrammer/lurker/issues/34) and the related ExtLinks-fallback work).

### Database

SQLite at `./lurker.db` (relative to cwd). In Docker the cwd is `/data`, so production stores at `/data/lurker.db`. In dev, you'll see `lurker.db` appear in the project root after first run.

[src/db.js](src/db.js) creates tables on import via `CREATE TABLE IF NOT EXISTS`, then runs forward-only migrations via the `migrations` table + `runMigration(name, fn)` pattern. **Never edit prior migration functions** — write a new migration even for typo fixes (see PR #20 for the `PRAGMA foriegn_keys` typo precedent: it was fixed by changing the migration content, but only because the migration had no real-world effect). For real behavioral changes, add a new migration.

Tables: `users` (with `pref_*` columns), `subscriptions`, `multireddits`, `invites`, `sessions` + `views` (for the Track Sessions dedup feature), `migrations`.

### Auth model

- **JWT in `auth_token` httpOnly cookie**, 5-day expiry
- **`JWT_KEY` is randomized at every startup** ([src/index.js:7](src/index.js#L7)) — *intentional*, but means all sessions invalidate on every container restart. Don't treat this as a bug.
- **Invite-only registration**: first user becomes admin automatically; subsequent registrations require an unused invite token (`/register?token=<>`)
- `authenticateToken` (cookie verify only) vs. `authenticateAdmin` (cookie + DB admin row check) — pick the right middleware
- Login `redirect` param is validated as relative-only at [src/routes/index.js:508](src/routes/index.js#L508) (PR #20 hardening)

### Preferences — the canonical pattern

Adding a user preference touches **five places** in a fixed pattern. When implementing prefs from Issues (#28, #29, #30, #31, #37), follow this:

1. **Schema migration** in `src/db.js`: `runMigration("add-<name>", ...)` adding `pref_<name>` to `users`
2. **`prefToColumn` map** in `src/routes/index.js` `/set-pref` handler (~line 566) — this map is the security boundary preventing arbitrary column updates (PR #20 hardening; never inline column names)
3. **`get_user_prefs` helper** at the bottom of `src/routes/index.js` — add the column to SELECT and the property to the returned object
4. **Dashboard UI** in `src/views/dashboard.pug` — checkbox/toggle following the existing AutoMod or trackSessions pattern
5. **Template consumption** — read `prefs.<name>` in whichever pug template applies the behavior

## Conventions

### Branch and release model (GitHub Flow, since v2.5.1)

- **`main` is the only long-lived branch.** The `dev` branch was retired on 2026-05-28; **do not recreate it.**
- Feature branches → `main` via PR. Merge commit style (preserves history per existing PR pattern).
- Branch names are not load-bearing — `feat-x`, `fix-y`, `claude/<thing>` are all fine.
- Tag `v<MAJOR>.<MINOR>.<PATCH>` on the merge commit → [publish-docker.yml](.github/workflows/publish-docker.yml) builds `lurker:X.Y.Z` and retags `:latest`.
- Push to `main` (pre-tag) → builds `lurker:edge`. In practice the merge→tag gap is under a minute, so `:edge` and `:latest` are nearly identical.
- Releases: tag, then `gh release create v<X.Y.Z>` with notes summarizing the PR contents.

### Version bumping

- **Patch** (`vX.Y.Z+1`): bug fixes, security fixes, dep updates, internal-only changes (e.g., CI cleanup)
- **Minor** (`vX.Y+1.0`): new features, new preferences, UI additions
- **Major** (`vX+1.0.0`): never used yet on this fork; reserve for breaking deployment changes

### Commit messages

Per global preferences: explain *why*, not *what*. End with `Co-Authored-By: Claude <noreply@anthropic.com>` for Claude-authored commits.

### Pug indentation

The codebase uses 2-space indents in `.pug` files. Mixed indentation in pug is a runtime error — match the file you're editing exactly.

### Foot guns

- **`Bun.CryptoHasher` is global Bun**, not imported. Don't `require` it.
- **`he.decode()` is applied at the route handler**, not in templates. Templates that emit reddit data use `!=` (unescaped) because the data was already decoded. Don't double-decode and don't pass un-decoded data to `!=`.
- **`src/routes/index.js` is one big file.** Helpers (`renderIndex`, `unescape_*`, `get_user_prefs`, `get_dashboard_data`) live **below** `module.exports = router;`. They work because `module.exports` assignment happens before the functions are called at request time.
- **Selftext links** rendered inline use `.inline` styling. There are CSS quirks around `.self-text-overflow.card` clipping (see [Issue #22](https://github.com/PortableProgrammer/lurker/issues/22)).
- **`details` element id collision** with the post-container fragment target — see [Issue #24](https://github.com/PortableProgrammer/lurker/issues/24) for the canonical example. Fragment-targeting bugs in this codebase usually trace to this pattern.

## Backlog visibility

- **GitHub Issues are canonical.** 17 issues (#22–#38) were filed on 2026-05-28 covering the entire known backlog. Check these before starting new work to avoid duplication.
- **Custom labels**: `auth` (SSO work), `tech-debt` (maintenance), `experimental` (opt-in features that may be removed)
- **Project memory** (Claude Code sessions only): `~/Code/claude-ops/projects/lurker/memory/` (symlinked from the standard project memory path). Currently holds `verify-after-k8s-rebuild.md` with 5 items awaiting live-instance repro.

## Upstream reference

`upstream` remote points at [oppiliappan/lurker](https://github.com/oppiliappan/lurker). The `master` branch there is the original repo. Upstream PRs occasionally have features worth cherry-picking — currently [oppiliappan PR #36](https://github.com/oppiliappan/lurker/pull/36) is the source we'll mine for OIDC ([Issue #35](https://github.com/PortableProgrammer/lurker/issues/35)).
