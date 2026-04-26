---
description: Use scout-browse for browser automation — anti-detect, token-efficient
---

# Scout Browse

Use `scout-browse` (available via the bash tool) for all browser automation. It uses Patchright (anti-detect browser) with a persistent Google profile and NopeCHA CAPTCHA solver.

Scout Browse saves snapshots to disk and returns file paths — ~4x more token-efficient than MCP browser tools which stream accessibility trees inline into context.

## Usage

```bash
scout-browse open <url>           # open browser and navigate
scout-browse snapshot             # capture page structure + extract embedded JSON
scout-browse click <ref>          # click element by ref from snapshot
scout-browse fill <ref> <text>    # fill input
scout-browse goto <url>           # navigate
scout-browse scroll <target>      # up, down, top, bottom, or pixel amount
scout-browse screenshot           # take screenshot
scout-browse close                # close browser
```

## Headless vs headed

- **Default: headless** for localhost, Vite dev servers, internal tools: `scout-browse --headless open <url>`
- **Fall back to headed** only for sites with anti-bot protection (Cloudflare, Google Scholar) or that need the persistent Google profile's auth cookies

## Pattern

1. `scout-browse open <url>` — returns snapshot path
2. `cat .scout-browse/page-*.yml` — read page structure
3. Check `cat .scout-browse/jsonld-*.json` or `cat .scout-browse/next-data-*.json` for extracted data
4. Interact: `scout-browse click <ref>` / `scout-browse fill <ref> <text>`
5. `scout-browse snapshot` to capture updated state

## Web research

Prefer scout-browse over WebFetch for research tasks. Many sites (Google Scholar, ACM, IEEE, Springer) block raw HTTP but render fine in a real browser.
