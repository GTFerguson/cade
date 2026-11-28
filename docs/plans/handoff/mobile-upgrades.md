---
title: Mobile upgrades: a phone that answers blocked sessions, not a desktop terminal on a small screen
created: 2026-11-27
updated: 2026-11-27
status: in-flight
---

# Resume: build phase 5 of the organisation roadmap, the mobile experience

Gary chose this as the next stream on 27 Nov. Pull request state, the quick-draw queue and one-tap answers for Claude Code shipped the same day. The reading view is next.

## Governing plans

- **What to build and why**: [[../organisation-and-cleanup-roadmap#5. Mobile experience]]. It holds the items, their key challenges and Gary's answers to the open questions (27 Nov). This file holds only execution state.
- **Neighbouring plan, separate scope**: [[../remote-access-overhaul]]. It covers device measurement, chat on the phone, QR sign-in and writing up the route a phone uses to reach the desktop backend. Pick those up only if Gary asks.
- **How the phone works today**: [[../../technical/core/remote-sessions]] (attention, push, size control, the handshake) and [[../../technical/core/frontend-architecture#MobileUI (`mobile.ts`)]]. The user guide is [[../../user/mobile-guide]].

## Where we are

Built and in use on the phone (`frontend/src/ui/mobile.ts`, `frontend/src/ui/mobile/`): the session strip with workspace and attention marks, the composer and key strip, the command menu, search, recent files, the file viewer and the dashboard screen.

Committed and pushed, **not installed** (see the install below): pull request state on the phone; the quick-draw queue with answer buttons for Claude Code; attention that knows a question from a permission prompt through the `PermissionRequest` hook, pushing only once a dialog has been left for Claude Code's six seconds; answers sent without taking over the terminal's size. Design and evidence are in [[../../technical/core/remote-sessions#Attention]] and [[../../technical/core/frontend-architecture#MobileUI (`mobile.ts`)]].

Evidence for the answer keys: a scratch Claude Code 2.1.332 session driven through a pty on 27 Nov (`--permission-mode default`, project-only logging hooks, its own folder; none of Gary's sessions). Checked in the `mobile-remote` demo at 390x844; not yet on a real phone or against the installed backend. The `PermissionRequest` hook is registered in `~/.claude/settings.json` by CADE's hook setup when the new backend starts, so it takes effect after the install.

## Checkout and evidence

- `/home/gary/projects/cade`, branch `main`. The repository is public.
- Untracked files that belong to other sessions; never stage them: `AGENTS.md`, `docs/plans/padarax-gm-crossrefs.md`.

## Next actions

1. **The install is still owed.** The permission check refused `make install-desktop` again on 27 Nov, after Gary's "do it ffs", so Gary runs it himself: `! PATH="$PWD/.venv/bin:$PATH" make install-desktop`. What it carries and what to check after it is in [[organisation-and-cleanup#Next actions (ordered)]] item 1; add, on the phone: the strip's pull request mark; **[cmd] → [queue]** with a permission prompt waiting in a Claude Code tab open on the phone, answered with a button, and the desktop terminal keeping its width; a question (`AskUserQuestion`) dealt after the permission prompt; no push for a dialog answered at the desk within six seconds. `[confirm]`
2. **The reading view, built to sit beside the terminal.** Gary will choose the phone's default after seeing both side by side, so build it as a switchable view and show him; do not make either the default yet. It depends on each agent's transcript format (`backend/cc_session_resolver.py` for Claude Code). Neither agent promises to keep that format stable. `[safe]`
3. **Remaining answer gaps**, in the roadmap's phase 5: Codex's keys (check them the same way: a scratch session through a pty, never one of Gary's), sessions without a tab on the phone, multi-select and multi-question dialogs. `[safe]`
4. **After each shipped item**: document it in `docs/technical/` and `docs/user/mobile-guide.md` in the same change, commit and push, and shrink the roadmap's phase 5. `[safe]`

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

Green on 28 Nov after the queue restyle: 991 frontend, 1,577 backend. Two backend tests have each failed once in a full run and pass alone: `test_session_scope.py::TestFallback::test_runs_as_a_plain_child_without_systemd` and `test_file_tools.py::TestReadFiles::test_offset_and_limit_apply_per_file`.
