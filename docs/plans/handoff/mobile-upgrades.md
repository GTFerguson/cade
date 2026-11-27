---
title: Mobile upgrades: a phone that answers blocked sessions, not a desktop terminal on a small screen
created: 2026-11-27
updated: 2026-11-27
status: in-flight
---

# Resume: build phase 5 of the organisation roadmap, the mobile experience

Gary chose this as the next stream on 27 Nov. Pull request state and the quick-draw queue (without answer buttons) shipped the same day. Answer buttons on the cards are next, and need Gary at a real session.

## Governing plans

- **What to build and why**: [[../organisation-and-cleanup-roadmap#5. Mobile experience]]. It holds the items, their key challenges and Gary's answers to the open questions (27 Nov). This file holds only execution state.
- **Neighbouring plan, separate scope**: [[../remote-access-overhaul]]. It covers device measurement, chat on the phone, QR sign-in and writing up the route a phone uses to reach the desktop backend. Pick those up only if Gary asks.
- **How the phone works today**: [[../../technical/core/remote-sessions]] (attention, push, size control, the handshake) and [[../../technical/core/frontend-architecture#MobileUI (`mobile.ts`)]]. The user guide is [[../../user/mobile-guide]].

`remote-access-iteration.md` in this folder is an untracked handoff from another session (15 Oct). It covers the same phone work, and its port, build steps and next actions are out of date. Everything in it that still holds is carried below. It was left in place because it is not this stream's file: ask Gary whether to delete it.

## Where we are

Built and in use on the phone (`frontend/src/ui/mobile.ts`, `frontend/src/ui/mobile/`): the session strip with workspace and attention marks, the composer and key strip, the command menu, search, recent files, the file viewer and the dashboard screen.

Attention changes committed, pushed and **not installed** (see the install below):

- `fcabe41e`: Claude Code's idle reminder no longer turns a finished tab into a waiting one.
- Codex approval prompts come from the terminal title (`CODEX_PROMPT_TITLE`), not a hook.
- A waiting session records what it wants (`attention_kind`: permission or question), sent as `kind` on `session-attention` and `attentionKind`/`attentionAt` in the session list. See [[../../technical/core/remote-sessions#Attention]].

On the phone, also not installed: pull request state on the session strip and in the menu, and the quick-draw queue (**[cmd] → [queue]**), which deals cards in Gary's order and quotes the prompt from the agent's screen, with "go to it" and "next". Both are described in [[../../technical/core/frontend-architecture#MobileUI (`mobile.ts`)]]. Checked in the `mobile-remote` demo at 390x844, not on a real phone.

What the hooks can tell a permission card is recorded in the roadmap's key challenges (Claude Code hooks documentation, read 27 Nov).

## Checkout and evidence

- `/home/gary/projects/cade`, branch `main`. The repository is public.
- Untracked files that belong to other sessions; never stage them: `AGENTS.md`, `docs/plans/handoff/remote-access-iteration.md`, `docs/plans/padarax-gm-crossrefs.md`.

## Next actions

1. **The install is still owed.** Everything since 26 Nov 17:40 is committed and not installed, now including the phone's pull request state, the queue and the attention kind. The permission check refused `make install-desktop` twice on a loose "yes" (and "okay do it" was read as carry on, not install), so it runs only when Gary writes something like "run make install-desktop", or runs it himself as `! PATH="$PWD/.venv/bin:$PATH" make install-desktop`. What it carries and what to check after it is in [[organisation-and-cleanup#Next actions (ordered)]] item 1; add: on the phone, the strip's pull request mark, and **[cmd] → [queue]** with one permission prompt and one finished turn waiting. `[confirm]`
2. **Answer buttons on the queue's cards, checked with Gary at a real session.** Two things the documentation does not settle and that must be seen before any button sends a key, because a wrong key on an approval is the one mistake this mode must not make:
   - Which keystroke picks each option of Claude Code's permission dialog (does a digit choose and confirm, or only move the cursor?), and the same for Codex's approval prompt.
   - Whether a `PermissionRequest` hook that exits 0 with no output leaves the dialog untouched. If it does, register it in `backend/hooks/` to give the card the tool name and input; the options themselves can only come from the screen.
   Do this in a session Gary opens for the purpose, never by attaching a test client to one of his live sessions. Build the buttons from the options parsed off the screen (`screenTail` already quotes them), keyed by session and `attentionAt` so a card cannot be answered twice, and move to the next card on an answer. `[confirm]`
3. **The reading view, built to sit beside the terminal.** Gary will choose the phone's default after seeing both side by side, so build it as a switchable view and show him; do not make either the default yet. It depends on each agent's transcript format (`backend/cc_session_resolver.py` for Claude Code). Neither agent promises to keep that format stable. `[safe]`
4. **After each shipped item**: document it in `docs/technical/` and `docs/user/mobile-guide.md` in the same change, commit and push, and shrink the roadmap's phase 5. Batch installs; do not install after each change. `[safe]`

Quick-draw on the desktop is out of scope until Gary raises it.

## Verifying on the phone without a phone

- Visual check: run the Vite dev server with `?demo=mobile-remote` and scout-browse headless at 390x844. The recipe and its gotchas are in the memory note on the mobile headless check. Add demo events to `frontend/src/demo.ts` for new screens, for example a session in each attention state.
- Never attach a test or headless client to one of Gary's live sessions: it can resize his PTY and garble the tab. For a check against a backend, start a throwaway one with its own home: `HOME=<scratch>/home .venv/bin/python -m backend.main serve --port <free> --host 127.0.0.1 --no-browser`.
- The phone reaches the desktop backend over Tailscale Serve. The backend's port is picked at each app launch, so `tailscale serve --bg <port>` has to be repointed after a relaunch, though not after an in-place upgrade, which keeps the port. Read the current port from `~/.cade/port`. The first HTTPS request after repointing takes about 25 seconds for the certificate.

## Build and test

```bash
cd /home/gary/projects/cade && .venv/bin/python -m pytest backend/tests -q -p no:cacheprovider
cd /home/gary/projects/cade/frontend && npx tsc --noEmit -p . && npx vitest run
```

Green on 27 Nov after the queue: 973 frontend, 1,569 backend. Two backend tests have each failed once in a full run and pass alone: `test_session_scope.py::TestFallback::test_runs_as_a_plain_child_without_systemd` and `test_file_tools.py::TestReadFiles::test_offset_and_limit_apply_per_file`.
