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

`npm test` runs the reground tests, the extension tests, and `check-plan.mjs`. The
"plan dry-run shape" test needs a Cursor checkout and skips itself unless
`CURSOR_PSTACK_DIR` points at one.

To pull zenspc's own newer rules instead, diff this fork against their `packages/pi-pstack`
before running the reground, and fold in whatever they changed.
