# Fork notes

This is a personal pi fork of [`@zenspc/pi-pstack`](https://www.npmjs.com/package/@zenspc/pi-pstack) 0.6.0
(upstream gitHead `10eb5399458a3946d287edba8d6cbfcf16952658`), which ports
[`cursor/plugins/pstack`](https://github.com/cursor/plugins/tree/main/pstack) to pi.

License stays MIT. `LICENSE` keeps Lauren Tan's copyright notice and adds the modification
copyright. See [License](#license).

## Why this fork exists

The upstream port still carries a few Cursor-only references that resolve to nothing in pi,
and npm-installed package files cannot be patched in place. This fork keeps the upstream text
and adds local harness fixes on top.

Fixes beyond upstream 0.6.0:

- Session transcripts use `$PI_SESSION_FILE` and `~/.pi/agent/sessions/--<cwd>--/` instead of
  Cursor's `agent-transcripts/`.
- Subagent launches use pi parameters. `run_in_background` becomes `async: true`,
  `environment: "cloud"` becomes `worktree: true`, and read-only work is an agent whose `tools`
  exclude `edit` and `write`.
- The Cursor cloud-agent concepts are gone. Owners, roots, and verifiers run locally.
- The todo list names the `todo` tool from `@juicesharp/rpiv-todo`.
- Poteto Mode is on when a session starts, so it needs no manual `/poteto-mode`. `/poteto-mode off`
  turns it off for the rest of that session only, and the next session starts with it on. Upstream
  starts every session with the mode off.
- Poteto Mode's skill body is injected once per context as a hidden custom message instead of a
  per-turn one-liner in the system prompt. A marker in the context decides re-injection, so
  compaction dropping the body brings it back. The form follows `ayghri/i-have-adhd`'s always-on
  extension (MIT).
- `Bugbot` wording becomes generic review-automation wording, and
  `references/bugbot-triage.md` is renamed to `references/review-triage.md`.
- The reground tool refuses to finish if any of those tokens survive a sync.

## Required plugins

- [`@juicesharp/rpiv-todo`](https://www.npmjs.com/package/@juicesharp/rpiv-todo) provides the `todo` tool.
- [`@juicesharp/rpiv-ask-user-question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question)
  provides the `ask_user_question` tool.

## Install

```bash
pi install git:github.com/azzz9/pi-pstack@<sha>
```

`pi-subagents` is required for `comment-sicko`, `poteto-agent`, and the workflow fan-outs.

## License

MIT. The chain of authorship is this.

| Layer | Copyright |
| --- | --- |
| `cursor/plugins/pstack` | Copyright (c) 2026 Lauren Tan |
| `@zenspc/pi-pstack` port | dhairyaar, MIT, Lauren Tan's notice preserved |
| This fork | Modifications Copyright (c) 2026 azzz9 |

`LICENSE` carries the original notice and the modification notice, which is what MIT requires
for a copy or a substantial portion. The `skills/` prose and the extension code are covered by
the same license.

## Detecting upstream drift

`upstream.lock.json` records the Cursor checkout the tree was last regenerated from.
`scripts/reground-from-cursor.mjs` writes that file after a sync has applied and passed its seam
assertion, so the lock cannot claim a sync that failed.

```bash
npm run check-upstream            # human report; exit 1 when upstream moved
npm run check-upstream -- --json  # same result as JSON, for a scheduler
```

`.github/workflows/upstream-drift.yml` runs that command weekly and on demand, opens one issue
whose title is its identity, updates that issue while the drift lasts, and closes it in sync.
Drift opens the issue; a check that could not run fails the job instead, so an unusable probe
never files a false report.

The check reads the newest commit that touched `pstack/` upstream, and the newest one reachable
from the recorded `sourceCommit`, then compares those two. It does not compare repository HEAD,
because `cursor/plugins` is a monorepo where other plugins commit constantly. `sourceCommit` is
the whole-checkout commit, so a depth-1 sparse clone is enough to record it, and the pstack-scoped
commit is derived the same way on both sides.

On drift it lists the changed paths under `pstack/`, split by what a reground costs. `adapt` and
`copy` files get rewritten, `unclassified` is a path the classifier has never seen, and `pi-only`
plus `never-copy` are ignored. A path named by `scripts/pi-harness-fixes.json` is flagged with its
rule count, since those are the rules a sync has to rewrite. When upstream reports 300 changed
files the list is capped, and the report says so.

Exit codes: `0` in sync, `1` upstream moved, `2` the check could not run, `3` upstream's `pstack/`
is gone, `4` no sync point recorded yet. Drift and failure never share a code, so a scheduler can
tell a moved upstream from a rate-limited probe.

Schema 1 of the lock is a bootstrap. This fork's content came from `@zenspc/pi-pstack` 0.6.0,
which synced Cursor pstack 0.15.0, and no Cursor commit was ever recorded for it, so
`sourceCommit` is `null` until a reground writes a real one and the check reports `unbaselined`.

The recorded `version` is the upstream `plugin.json` value a reground reads, while `CHANGELOG.md`
carries the port's own label. The two drift apart without either being wrong, because upstream
bumps its version for changes the harness already normalizes, so `0.15.0` and `0.15.2` can name
identical fork content. Read `version` as display metadata, and `sourceCommit` plus `syncedFiles`
as the identity.

`npm test` keeps the lock honest offline. It rehashes every `adapt` and `copy` file in the tree and
compares the result with `syncedFiles`, so a hand-edited synced file, a file added to the synced
region, or a lock bumped without a sync fails the suite with no network access.

## Syncing with Cursor upstream

`scripts/reground-from-cursor.mjs` rewrites a Cursor checkout into this package and then applies
`scripts/pi-harness-fixes.json`. The seam assertion fails the run when Cursor-only tokens survive,
so a sync cannot silently drop these fixes.

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/cursor/plugins.git /tmp/cursor-plugins
git -C /tmp/cursor-plugins sparse-checkout set pstack
node --experimental-strip-types scripts/reground-from-cursor.mjs \
  --from /tmp/cursor-plugins/pstack --to . --dry-run   # review the plan first
node --experimental-strip-types scripts/reground-from-cursor.mjs \
  --from /tmp/cursor-plugins/pstack --to .
npm test
```

`npm test` runs the reground tests, the check-upstream tests, the extension tests, and
`check-plan.mjs`. The "plan dry-run shape" test needs a Cursor checkout and skips itself unless
`CURSOR_PSTACK_DIR` points at one.

The reground ends by rewriting `upstream.lock.json` from that checkout and printing the sync
point. A run that fails its seam assertion writes no lock, so the next `npm run check-upstream`
still reports the drift. Read `--from` from a fresh clone: a stale checkout would record a sync
point that the tree behind it never reached.

To pull zenspc's own newer rules instead, diff this fork against their `packages/pi-pstack`
before running the reground, and fold in whatever they changed.
