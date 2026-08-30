# Legacy Frontend Cleanup Plan

**Status: not yet executed.** This document is a plan only — nothing in this file has been deleted or changed by writing it. Executing it is a separate, explicit future step. Every fact below was verified live against the current repo (commit `7570c94`) on 2026-08-31, not assumed from memory.

## What this removes

Exactly three things, and nothing else:

1. `views/*.html` — 11 files (`dashboard.html`, `gelco-docs.html`, `inward.html`, `items.html`, `login.html`, `notifications.html`, `outward.html`, `requests.html`, `settings.html`, `stock.html`, `transfer.html`). Every one of these has a live, working replacement in `frontend/app/`.
2. `public/css/style.css` and `public/js/app.js` — confirmed these are the **only two files** anywhere under `public/` (`find public -type f` returns exactly these two). Deleting the whole `public/` directory afterward is safe — there's nothing else in it to lose.
3. The now-dead Express wiring in `server.js` that only ever existed to serve #2: the `app.use('/public', express.static(...))` mount (line 83) and the `/public/` bypass clause inside the role-allowlist middleware (line 139, part of `if (req.path.startsWith('/api/') || req.path.startsWith('/public/')) return next();`).

## Explicitly out of scope — do not touch

- **`frontend/public/`** — a completely different directory. It's Next.js's own public folder (currently just placeholder SVGs: `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`, plus `favicon.ico`). Nothing about this cleanup touches it. Don't let the similar name cause a mix-up.
- **`192.168.1.50+2.pem` / `192.168.1.50+2-key.pem`** — SYSTEM.md separately flags these as dead (mkcert TLS files, never referenced by `server.js`, which is HTTP-only). They're unrelated to the frontend migration and one of them is a **private key file** — deleting it doesn't scrub it from git history, so removing it is a distinct security question (rotation/history-scrubbing), not a code-cleanup one. Not part of this plan; raise it separately if you want it handled.
- Anything under `node_modules/`, `.next/`, or other build output — untouched by definition.

## Pre-flight verification (already done — results below)

Ran before writing this plan, not assumed:

```
grep -rln "views/" --include="*.js" --include="*.json" --include="*.ts" --include="*.tsx" --include="*.md" .
  → SYSTEM.md, server.js, frontend/app/login/page.tsx, frontend/app/stock/page.tsx, frontend/lib/nav-links.ts
```
Checked every hit individually — all five are prose (comments or docs) referencing the legacy file for historical context, not functional imports or fetches, so none of them *break* if `views/` disappears. But they're not all equally worth fixing: `SYSTEM.md`'s hits are checkable documentation claims (handled as its own non-optional step, deletion-sequence step 3, below); the other four (`server.js`, `frontend/app/login/page.tsx`, `frontend/app/stock/page.tsx`, `frontend/lib/nav-links.ts`) are just code comments/breadcrumbs (cosmetic, optional, step 4).

```
grep -rln "public/js\|public/css\|'/public'\|\"/public\"" --include="*.js" --include="*.json" --include="*.ts" --include="*.tsx" .
  → server.js, frontend/app/layout.tsx, frontend/lib/api.ts, frontend/lib/format.ts, public/js/app.js
```
Checked each: `server.js`'s hits are the two lines named above (in scope, handled in deletion-sequence step 2). The three `frontend/lib`/`frontend/app` hits are unrelated matches on the substring "public" in other contexts (not `/public/` path references) — confirmed none of them touch the root `public/` directory.

```
grep -n "sendFile" server.js  →  only in comments (lines 13, 154), no live res.sendFile() calls
git ls-files views/ public/   →  all 13 files are git-tracked
git status --short            →  clean working tree
grep -n "views\|public" .gitignore package.json  →  no hits, nothing to update there
find . -iname "*.test.*" -o -iname "*.spec.*" (excl. node_modules)  →  no test files exist in this repo at all
```

**Conclusion: zero live code depends on any of the three items in scope.** The only edits needed outside deleting the files themselves are the two dead lines in `server.js`.

## Safety net (do this first, before deleting anything)

1. Confirm the working tree is clean (`git status --short` — should be empty, matching the state at commit `7570c94`).
2. Tag the current commit so there's a one-command way back to exactly this state, no matter what else happens on `main` afterward:
   ```bash
   git tag pre-legacy-cleanup
   git push origin pre-legacy-cleanup
   ```
3. Confirm the app currently builds and runs clean **before** touching anything, so there's an unambiguous "before" baseline to compare against:
   ```bash
   npm run build   # from repo root — must succeed
   ```

## Deletion sequence

Do these as one logical change, but as separate commands so each is individually reviewable in `git status` before committing:

1. **Remove the legacy files via `git rm`** (not plain `rm` — keeps the deletion staged and reviewable):
   ```bash
   git rm views/*.html
   git rm -r public/
   ```
2. **Edit `server.js`** — remove exactly two things:
   - Line 83: `app.use('/public', express.static(path.join(__dirname, 'public')));`
   - Inside the role-allowlist middleware (line 139): change
     `if (req.path.startsWith('/api/') || req.path.startsWith('/public/')) return next();`
     to
     `if (req.path.startsWith('/api/')) return next();`
   - Also remove the now-unused `const path = require('path');` (line 6). Verified: `path.join` on line 83 is its only real usage — the two `pathFilter: (path) => ...` arrow functions (lines 36, 59) take a locally-scoped parameter that happens to share the name and shadows the import, and the other hits (`req.path.startsWith(...)`, lines 94/139) are a property on the request object, not the module. Once line 83 is gone, the import is genuinely dead.
3. **`SYSTEM.md` — not optional, do this one.** Unlike the code comments below, `SYSTEM.md` is the project's primary living documentation, and it makes specific, checkable claims that become false once the files are gone:
   - Line 13: "`public/js/app.js` + `public/css/style.css` + every `views/*.html` file are legacy, fully unreferenced by any live route, **kept on disk only for rollback**" — the "kept on disk" clause becomes false; reword to say they were removed in this cleanup (reference the commit).
   - Line 226: "**Legacy files are fully dead but intentionally still on disk**: ... Safe to delete in one cleanup commit once this has been stable in production for a while — see task list below." — this entire bullet describes a not-yet-done state; replace it with a note that the cleanup happened (date/commit), or strike it.
   - Line 257 (§6a task backlog item #6, "Legacy cleanup, carefully"): mark this item done.
   - **Leave §6 (the whole "Frontend (legacy...)" section, lines ~185 onward, including the `GET /login`/`views/login.html` route docs at lines 90/92) alone** — it explicitly says it's "kept as-is (not rewritten)... still useful as a reference for 'what did the old version do'" (line 185). That's a deliberate historical-reference decision predating this cleanup, not a stale-doc problem this cleanup should fix. Don't touch it just because it mentions `views/`.

4. **Cosmetic, optional, do last**: update or remove the stale `views/*.html` *code comments* (not documentation — these don't make claims anyone reads for accuracy, they're just breadcrumbs) so they don't describe a file that no longer exists — `server.js` (the block at lines 12-16 and 153-157), `frontend/app/login/page.tsx:11`, `frontend/app/stock/page.tsx:21`, `frontend/lib/nav-links.ts:4`. Purely comment text, zero functional risk either way — fine to skip this step if you'd rather keep the diff minimal.

## Verification after deletion, before committing

All of these must pass before this becomes a commit:

1. `npx tsc --noEmit` in `frontend/` — must stay clean.
2. `node -c server.js` — syntax check the edited file.
3. `npm run build` from repo root — full production build must still succeed (this is the strongest signal that nothing broke, since it exercises the whole Next.js build alongside Express).
4. Start both dev servers (`npm run dev` + `npm run dev:next`) and manually confirm, for a logged-in `admin` session, that all 11 migrated pages still load with **no 404s and no console errors**: `/`, `/inward`, `/outward`, `/transfer`, `/dashboard`, `/requests`, `/stock`, `/settings`, `/notifications`, `/gelco-docs`, `/login`.
5. Confirm the role-allowlist redirects still work now that the `/public/` bypass clause is gone (it should be — that clause only ever mattered for requests actually starting with `/public/`, which no longer exist): log in as a `client`-role account and confirm visiting `/inward` still redirects to `/stock`; log in as `gelco_worker` and confirm `/dashboard` still redirects to `/inward`.
6. `curl -I http://localhost:3000/public/js/app.js` should now return `404` (previously `200`) — confirms the dead static mount is actually gone, not just silently still there.
7. Check `git status` — the diff should be exactly: 13 deletions (11 `views/*.html` + `public/css/style.css` + `public/js/app.js`), the edit in `server.js`, the `SYSTEM.md` doc updates (step 3, not optional), and optionally the code-comment cleanups from step 4. Nothing else.

## Commit and push

Keep this as its own commit, separate from any unrelated work, so it's a single clean revert target if ever needed:

```bash
git commit -m "Remove dead legacy frontend: views/*.html, public/js+css (superseded by frontend/)"
git push origin main
```

## Rollback plan (if something breaks after this ships)

- **Preferred**: `git revert <this-commit-sha>` — creates a new commit undoing exactly this change, keeps history intact, safe to push immediately.
- **Emergency only, requires explicit approval before running**: `git reset --hard pre-legacy-cleanup` (the tag from the safety-net step) followed by a force-push — destructive, rewrites history, only if a revert somehow isn't sufficient. Per the standing safety rules governing this session, I will not run a force-push or hard-reset without asking first, regardless of how this plan reads.

## What could still go wrong (honest residual risk)

- If Render (or any other deploy target) has a cached/CDN reference to `/public/js/app.js` or `/public/css/style.css` from before this change, clients with a stale cached page could 404 on those specific assets until their cache expires. Low risk — nothing in the current live app (post-migration) links to those URLs anymore, so this would only affect a browser tab that's been open since *before* the Next.js migration shipped, which is already stale in far more serious ways (it'd be running the pre-migration JS entirely, disconnected from the current API contract).
- If anyone has a local bookmark or muscle-memory habit of hitting `/public/js/app.js` directly for debugging, that stops working. No evidence this is a real workflow anyone uses, but noting it for completeness.

## When this plan is done

Once executed, verified stable, and pushed, this file has served its purpose — safe to delete it in a later commit rather than let it linger as a stale "to-do" that's actually already done.
