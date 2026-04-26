---
title: Browser Terminal Emulators — Landscape, Rendering Approaches, and Known Failures
created: 2026-04-25
updated: 2026-04-25
status: active
tags: [terminal, xterm, rendering, webgl, frontend]
---

# Browser Terminal Emulators — Landscape, Rendering Approaches, and Known Failures

Survey of the browser-based terminal emulator space: available libraries, rendering backends, and documented failure modes, with evidence for why xterm.js is the only practical choice and what known issues are unavoidable vs patchable.

## 1. Library Landscape

There is effectively one production-ready option for embedding a real PTY terminal in a browser application.

**xterm.js** (`@xterm/xterm`) is the only actively maintained, npm-packaged browser terminal emulator in wide production use. It powers VS Code's integrated terminal, GitHub Codespaces, Hyper, Theia, JupyterLab, ttyd, and most other browser-based shell interfaces (Tier 5: xtermjs.org, 2024; GitHub stars ~17k, npm weekly downloads ~4M). All competing tools either use xterm.js under the hood (ttyd, GoTTY, Wetty) or are unsuitable for real-PTY integration.

**hterm** (Google/ChromeOS, `chromium.googlesource.com/apps/libapps`) is the primary conceptual alternative. It uses a DOM-based renderer, prioritises correctness over performance, and is demonstrably more correct for CJK and selection behaviour (Tier 5: tbodt.com, 2017, independently verified by Snyk npm health, 2025). The deal-breakers for integration: it is not published to npm in updated form (last npm release 2.0.2), requires an awkward Google-authored module system, and has essentially zero third-party ecosystem or documentation outside ChromeOS. Dropped.

**DomTerm** is a DOM-based emulator that achieves excellent vttest scores and supports rich output (images, folding, pretty-printing). Its correctness is genuinely better than xterm.js's (Tier 5: domterm.org, 2024). Not npm-packaged, niche community, and its optional xterm.js backend mode reveals the team acknowledges xterm.js's performance advantage. Unsuitable for production embedding.

**jQuery Terminal, terminal.js, xterm.es**: jQuery Terminal is a command-line UI abstraction, not a PTY emulator. terminal.js is unmaintained. xterm.es is a minimal ES-module fork of xterm.js with no substantive rendering changes (Tier 5: github.com/vincentdchan/xterm.es).

**Verdict**: xterm.js is the only viable path. This is not an enthusiastic endorsement — it is a statement about the market.

## 2. xterm.js Rendering Backends

xterm.js ships three renderer backends via addons. Understanding the tradeoffs is necessary for workaround decisions.

| Renderer | Atlas | Font measurement | Known failures |
|----------|-------|-----------------|----------------|
| DOM | None (HTML elements) | Browser layout engine | Slow reflows; emoji clipping (issue #4813) |
| Canvas (`@xterm/addon-canvas`) | Texture atlas | `canvas.measureText()` | Glyph-width measurement bugs on some GPU/DPI combos (issue #3548); canvas CharAtlas lifecycle/refresh bugs |
| WebGL (`@xterm/addon-webgl`) | GPU texture atlas | `canvas.measureText()` at init | Font-measurement race; atlas bakes stale metrics; multiple documented rendering regressions |

**DOM renderer** is the correctness floor. No atlas means no atlas bugs; HTML layout handles font metrics. The performance cost is ~3× more paint time than WebGL for large scrollbacks. For chat-style output (Claude Code's REPL UI) this is invisible (Tier 5: xterm.js issue #3271, maintainer discussion, 2022).

**Canvas renderer** was introduced to address WebGL atlas bugs but introduced its own: cell-width measurement varies across GPU/DPR combinations, producing white-block artifacts (Tier 5: CADE codebase history, commit b3f8bb8, 2026-04-24).

**WebGL renderer** is fastest but has the most documented rendering failures (see §3).

## 3. xterm.js WebGL Renderer — Documented Failures

These are confirmed bugs with issue numbers, not speculation.

**Font-measurement race condition** (issues #1164, #3817, #3280): xterm.js measures character cell dimensions at renderer attach time using `canvas.measureText()`. If the web font has not yet loaded when the WebGL addon attaches, the measurement uses system fallback metrics. The atlas is then baked with wrong cell dimensions. When the font later loads, `loadingdone` fires but re-assigning `options.fontFamily` to the same value is a no-op in xterm's option setter — the measurement does not re-run. Result: glyphs rasterised at wrong cell size, appear as black blocks or overflow adjacent cells. CADE has patched this via sentinel fontFamily toggle + `document.fonts.ready` await in `WebglRenderer` (commit after 8e7dc9d, 2026-04-25).

**WebGL regression — may not render as typing** (issue #4665, August 2023): A rendering optimisation pass introduced a regression where output written while the user is typing does not render immediately. Patched in a subsequent point release.

**Font doesn't rerender after font-family change** (issue #3280): Changing `terminal.options.fontFamily` to a new value does not trigger a full atlas rebuild in all code paths. The option setter has early-return logic that skips measurement when the new value is considered equivalent to the old.

**Software WebGL2 emulation** (Proxmox pve-devel, October 2023): Chrome without hardware GPU support falls back to software WebGL2 emulation, which does not always render every character. Proxmox added a detection step to fall back to the canvas renderer.

**allowTransparency thin text** (issue #4212): Setting `allowTransparency: true` causes abnormally thin text rendering in the WebGL renderer even when all colors are fully opaque. Architectural limitation in how transparency compositing interacts with the atlas.

**Powerline/NerdFont glyphs** (issue #2645): Characters in Unicode private-use areas (U+E000–U+F8FF) used by NerdFont/Powerline prompts are not in most system fonts and fall back to whatever the OS provides. The WebGL renderer may rasterise these with different metrics than the primary font, producing misaligned cells.

**Ligature rendering** (issue #3303): Ligatures in Chrome 89+ caused rendering artefacts with the WebGL renderer. Partially resolved; ligature support was later added as a fallback path not requiring font-access APIs.

## 4. xterm.js v5.x Improvements (Relevant to CADE)

**v5.1.0** (2023): Multiple texture atlas pages. Instead of a hard 1024×1024 cap, the atlas now starts at 512×512 and can grow through up to 8 pages to a maximum of 4096×4096. This eliminates atlas overflow as a source of black blocks for projects on v5.1+. CADE is on `^5.5.0` — overflow is not the current issue.

**v5.5.0** (2024): Added `rescaleOverlappingGlyphs` option. When enabled, glyphs that are single-cell-wide but visually overflow into the next cell are automatically scaled down. Targets ambiguous-width Unicode (Roman numeral characters U+2160+, GB18030 compliance). Not enabled by default.

**`clearTextureAtlas()`**: Available on both `Terminal` and `WebglAddon`. Clears the atlas and forces re-rasterisation without dispose+reattach. Lower overhead than full addon reload; does not remeasure cell dimensions. Useful when atlas state is corrupt but cell metrics are correct.

## 5. Pragmatic Renderer Choice for CADE

Claude Code (cc) produces high-volume structured output: bordered boxes, inline code spans with background colour, ANSI colour sequences, box-drawing characters, Unicode markers. This creates many distinct glyph+colour combinations and taxes the WebGL atlas.

The rendering failure CADE has experienced (black blocks on brand-new instances) is the font-measurement race (§3, #1164/#3817/#3280), not atlas overflow (ruled out by v5.1+ multi-page atlas and brand-new-instance reproduction).

**Recommended per-pane renderer strategy**:

| Terminal use | Recommended renderer | Reason |
|---|---|---|
| Claude Code (cc) chat output | DOM or WebGL + patched WebglRenderer | CC output is text-heavy, not latency-sensitive; DOM avoids all atlas issues; patched WebGL acceptable if fix holds |
| Raw shell (bash, vim, tmux) | WebGL | Latency-sensitive; vim/htop need 60fps; DOM is visibly slower |
| Neovim pane | WebGL | Same as raw shell |

**Option to add**: `rescaleOverlappingGlyphs: true` on all terminals. Zero performance cost; prevents a class of overlap bugs from ambiguous-width glyphs.

## 6. Non-Browser Alternative (For Context)

Warp terminal (Rust/GPU, closed-source) built its own rendering stack using GPUI (a hybrid immediate/retained mode UI framework, later open-sourced as the foundation of the Zed editor) and Metal/Vulkan for text rasterisation (Tier 5: warp.dev/blog/how-warp-works, 2024). GPU-accelerated rendering pushes 400+ fps on 4K/240Hz displays. This approach is architecturally unavailable to a web application: GPUI is a native framework, and WebGPU (the successor to WebGL) is not yet used by any terminal emulator for production rendering. The lesson is that correctness at speed requires owning the render pipeline — which xterm.js's plugin architecture structurally cannot offer.

## References

- xterm.js GitHub issues: #1164 (web font support), #3280 (WebGL/font-family change), #3817 (imported fonts not used), #4665 (WebGL regression), #4212 (transparency thin text), #2645 (Powerline WebGL), #3548 (canvas CharAtlas lifecycle), #3303 (ligatures WebGL), #4813 (DOM emoji clipping) — github.com/xtermjs/xterm.js
- xterm.js Release 5.1.0: Multiple texture atlas pages — github.com/xtermjs/xterm.js/releases/tag/5.1.0
- xterm.js Release 5.5.0: rescaleOverlappingGlyphs — github.com/xtermjs/xterm.js/releases/tag/5.5.0
- xterm.js Pull #4244: Support multiple texture atlas pages — github.com/xtermjs/xterm.js/pull/4244
- tbodt (2017): hterm vs xterm.js — tbodt.com/2017/11/05/hterm-xterm.html
- Warp: How Warp Works (2024) — warp.dev/blog/how-warp-works
- Proxmox pve-devel: WebGL2 software emulation detection patch (October 2023) — lists.proxmox.com/pipermail/pve-devel/2023-October/059631.html
- DomTerm: Features and vttest compatibility — domterm.org/Features.html
- hterm npm health: Snyk Advisor, last updated January 2025 — snyk.io/advisor/npm-package/hterm
