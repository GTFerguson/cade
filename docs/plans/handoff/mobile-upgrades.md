---
title: Mobile upgrades: a phone that answers blocked sessions, not a desktop terminal on a small screen
created: 2026-11-27
updated: 2026-11-27
status: in-flight
---

# Resume: build phase 5 of the organisation roadmap, the mobile experience

Gary chose this as the next stream on 27 Nov. Nothing for it is built yet.

## Governing plans

- **What to build and why**: [[../organisation-and-cleanup-roadmap#5. Mobile experience]]. It holds the four items, their key challenges and three open questions. This file holds only execution state.
- **Neighbouring plan, separate scope**: [[../remote-access-overhaul]]. It covers device measurement, chat on the phone, QR sign-in and writing up the route a phone uses to reach the desktop backend. Pick those up only if Gary asks.
- **How the phone works today**: [[../../technical/core/remote-sessions]] (attention, push, size control, the handshake) and [[../../technical/core/frontend-architecture#MobileUI (`mobile.ts`)]]. The user guide is [[../../user/mobile-guide]].

`remote-access-iteration.md` in this folder is an untracked handoff from another session (15 Oct). It covers the same phone work, and its port, build steps and next actions are out of date. Everything in it that still holds is carried below. It was left in place because it is not this stream's file: ask Gary whether to delete it.

## Where we are

Built and in use on the phone (`frontend/src/ui/mobile.ts`, `frontend/src/ui/mobile/`): the session strip with workspace and attention marks, the composer and key strip, the command menu, search, recent files, the file viewer and the dashboard screen.

Attention, which the quick-draw queue would read, is `input` / `working` / `idle` (`backend/terminal/attention.py`). Two changes to it are committed, pushed and **not installed** (see the install below):

- `fcabe41e`: Claude Code's idle reminder no longer turns a finished tab into a waiting one. The queue would have been full of finished tabs without it.
- Codex approval prompts come from the terminal title (`CODEX_PROMPT_TITLE`), not a hook.

The phone shows no pull request state. The data is already sent: `pullRequest` on each session in `session-list`, and `session-context` per session with the stream's ticket, pull request and branch (`backend/session_context.py`). `frontend/src/ui/mobile/session-strip.ts` reads neither.

## Checkout and evidence

- `/home/gary/projects/cade`, branch `main`, pushed through `fa257c37` (27 Nov). The repository is public.
- Untracked files that belong to other sessions; never stage them: `AGENTS.md`, `docs/plans/handoff/remote-access-iteration.md`, `docs/plans/padarax-gm-crossrefs.md`.

## Next actions

1. **The install is still owed.** Everything since 26 Nov 17:40 is committed and not installed. The permission check refused `make install-desktop` twice on a loose "yes", so it runs only when Gary writes something like "run make install-desktop", or runs it himself as `! PATH="$PWD/.venv/bin:$PATH" make install-desktop`. What it carries and what to check after it is in [[organisation-and-cleanup#Next actions (ordered)]] item 1. `[confirm]`
2. **Ask Gary the roadmap's three open questions**, unless he has already answered them: reading view or terminal as the phone's default; whether finished turns belong in the queue; quick-draw on desktop too. Start building with these defaults if he has not answered: terminal stays the default; the queue holds only blocked sessions (permission prompts and questions), with finished turns counted but not queued; phone only. `[safe]`
3. **Pull request state on the phone first.** The data is already on the client, so this proves the work end to end at small cost. Show the stream's pull request mark and state in the session strip, reusing `frontend/src/tabs/work-words.ts`, which holds the pull request wording and ticket status colours the desktop strip and board share. `[safe]`
4. **The quick-draw queue.** Order: permission prompts, then questions, then the rest per item 2. Build the ordering as a pure function next to `session-strip.ts` with tests, then the screen. An answer given on the desktop clears attention through `session-attention`, so a card disappears from the phone when that arrives; check that no card can be answered twice. `[safe]`
5. **Find out what a permission card can know before designing it.** The roadmap assumes a Claude Code hook can supply the tool name and its input. Check this against Claude Code's current hook documentation (ask the `claude-code-guide` agent) rather than from memory. Today CADE gets only the `Notification` hook's message text for a permission prompt (`attention_hook.py`). Codex gives only its terminal title. Record what you find in the roadmap's key challenges before writing the card. The answer buttons must come from the prompt on screen, never a fixed layout. `[safe]`
6. **The reading view last.** It depends on each agent's transcript format (`backend/cc_session_resolver.py` for Claude Code). Neither agent promises to keep that format stable. `[safe]`
7. **After each shipped item**: document it in `docs/technical/` and `docs/user/mobile-guide.md` in the same change, commit and push, and shrink the roadmap's phase 5. Batch installs; do not install after each change.

## Verifying on the phone without a phone

- Visual check: run the Vite dev server with `?demo=mobile-remote` and scout-browse headless at 390x844. The recipe and its gotchas are in the memory note on the mobile headless check. Add demo events to `frontend/src/demo.ts` for new screens, for example a session in each attention state.
- Never attach a test or headless client to one of Gary's live sessions: it can resize his PTY and garble the tab. For a check against a backend, start a throwaway one with its own home: `HOME=<scratch>/home .venv/bin/python -m backend.main serve --port <free> --host 127.0.0.1 --no-browser`.
- The phone reaches the desktop backend over Tailscale Serve. The backend's port is picked at each app launch, so `tailscale serve --bg <port>` has to be repointed after a relaunch, though not after an in-place upgrade, which keeps the port. Read the current port from `~/.cade/port`. The first HTTPS request after repointing takes about 25 seconds for the certificate.

## Build and test

```bash
cd /home/gary/projects/cade && .venv/bin/python -m pytest backend/tests -q -p no:cacheprovider
cd /home/gary/projects/cade/frontend && npx tsc --noEmit -p . && npx vitest run
```

Both were green at `fa257c37`: 1,561 backend, 944 frontend. `test_session_scope.py::TestFallback::test_runs_as_a_plain_child_without_systemd` has failed once in a full run and passes alone.
