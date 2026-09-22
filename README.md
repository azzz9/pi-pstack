# @azzz9/pi-pstack

Personal pi fork of [`@zenspc/pi-pstack`](https://www.npmjs.com/package/@zenspc/pi-pstack) 0.6.0
(upstream gitHead `10eb539`), the pi port of
[`cursor/plugins` pstack](https://github.com/cursor/plugins/tree/main/pstack).

[FORK.md](FORK.md) is the diff record, and it is worth reading before changing anything here. It
lists the harness fixes this fork adds on top of upstream, the plugins the port expects, the MIT
authorship chain, and how `scripts/reground-from-cursor.mjs` re-applies the fixes after a Cursor
sync.

pstack for Pi: rigorous agent workflows you can parallelize with confidence.

If you want to go fast, go deep first. pstack helps you write less, but higher quality code. It gives you fearless parallelism: when an agent goes deep and writes good, verifiable code, you can parallelize with confidence. Start multiple agents with `poteto-mode` and trust they will apply rigorous engineering principles to their work.

## Install

```bash
pi install git:github.com/azzz9/pi-pstack@<sha>
```

Pin a commit sha when the install has to be reproducible. A Home Manager generation that lists this
package reconciles the pin on every activation and checks the clone back out, so an uncommitted edit
to `~/.pi/agent/git/github.com/azzz9/pi-pstack` does not survive.

The port expects these alongside it:

| Package | Why |
| --- | --- |
| [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) | `poteto-agent`, `comment-sicko`, and the workflow fan-outs (`how`, `why`, `arena`, `swarm`, `interrogate`, `reflect`) |
| [`@juicesharp/rpiv-todo`](https://www.npmjs.com/package/@juicesharp/rpiv-todo) | the `todo` tool the playbooks open |
| [`@juicesharp/rpiv-ask-user-question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question) | the structured `ask_user_question` tool poteto-mode asks through |
| [`bun`](https://bun.sh) | runs the bundled `orch` and `watch-pr` scripts |

## Get started

1. Run `/setup-pstack` once to pick which models each role uses (optional; every role inherits the parent session model otherwise).
2. Poteto Mode is on from the first turn of a session, so there is nothing to enable. `/poteto-mode off` turns it off for the rest of that session only; the next session starts with it on. `/poteto-mode <task>` and `/skill:poteto-mode` also turn it on.
3. Run `/pstack off` to hide even the four Discoverable skills (`how`, `why`, `unslop`, `typescript-best-practices`) from the Skill catalog.
   Off persists in `~/.pi/agent/pstack/models.json`.
   `/skill:<name>` keeps working.
   `/pstack on` restores those four, not all 47.
   `/pstack status` reports the current side.

That is it.
The other skills are Hidden; the mode skill uses them as needed.

## What you get

- **47 skills**, including:
  - `poteto-mode`: the main entry point. Reads your request, matches one of 23 playbooks (bug fix, perf, feature, refactoring, investigation, shipping, orchestrate, autopilot, and more), copies its steps in verbatim, and routes to the other skills as steps fire.
  - Workflow skills: `how`, `why`, `recall`, `blast-radius`, `architect`, `arena`, `swarm`, `interrogate`, `reflect`, `teach`, `tdd`, `no-comments`, `unslop`, `deslop`, `bro`, `figure-it-out`, `show-me-your-work`, `create-verification-skill`, `maintain-verification-skill`, `automate-me`, `technical-writing`, `typescript-best-practices`.
  - 23 principle skills (`principle-laziness-protocol`, `principle-model-the-domain`, `principle-prove-it-works`, ...), one rule each, indexed inline by `poteto-mode`.
- **2 subagents** (loaded by pi-subagents):
  - `poteto-agent`: runs poteto's style end to end. Reads `poteto-mode` in full before any work.
  - `comment-sicko`: read-only comment reviewer that savors deletion. Usually invoked through the `no-comments` skill.
- **Bundled scripts** in `poteto-mode/scripts/`: the `orch` coordination CLI (orchestrate playbook) and the `watch-pr` watcher (babysit playbook), both under [bun](https://bun.sh); `worktree-audit.sh` for the worktree-cleanup playbook; and `check-plan.mjs`, the plan checker the multi-phase playbooks call.

## Model roles

Per-role model choices live in `~/.pi/agent/pstack/models.json`. Run `/setup-pstack` to write it. The extension injects the role table only when a role has a real model slug. Default inherit-all injects nothing. `inherit-parent` or `auto` runs on the parent session model.

## Ported from the Cursor plugin

- Hidden skills set `disable-model-invocation: true`, so they stay out of the Skill catalog.
  `/skill:name` still loads the Skill body.
  The four Discoverable skills are `how`, `why`, `unslop`, and `typescript-best-practices`.
- Slash commands are `/skill:<name>` instead of `/name`.
- Subagent delegation uses pi-subagents (`subagent({ agent, task })`) instead of Cursor's Task tool. This package does not ship a replacement `subagent` tool.
- The benny automation pack is not ported; it depends on Cursor automations.
- `make-bot-ui` is not ported. It is Cursor Grok Bot / routine webhook UI.

The rest of the harness fixes — pi session paths, subagent parameters, no cloud agents, and
review-automation naming — are recorded in [FORK.md](FORK.md).

## License

MIT. [FORK.md](FORK.md) carries the authorship chain: Lauren Tan's notice from `cursor/plugins`
plus the modification notice for this fork.
