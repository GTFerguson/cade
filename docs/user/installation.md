---
title: Installation Guide
created: 2026-04-26
status: current
tags: [installation, setup, onboarding]
---

# CADE Installation Guide

This guide walks through a complete first-time setup. An AI agent can follow this step by step with the user.

## System Requirements

| Platform | Supported |
|----------|-----------|
| Linux x86_64 | Yes |
| macOS (Intel) | Yes |
| macOS (Apple Silicon) | Yes |
| Windows 10/11 x64 | Yes (via WSL) |

No additional runtime dependencies required — Node.js, Python, Neovim, and Chromium are all bundled.

---

## Step 1: Install the CADE App

Download the installer for your platform from the releases page and run it.

- **Linux**: `.deb` package or AppImage
- **macOS**: `.dmg` disk image
- **Windows**: `.msi` or NSIS installer

---

## Step 2: Authenticate with Claude

CADE's AI terminal runs on Claude Code. On first launch, open the CADE terminal and run:

```bash
claude login
```

This opens a browser to authenticate with your Anthropic account. Once done, Claude Code is ready and CADE will use it automatically.

> [!NOTE]
> If you already have Claude Code installed and authenticated system-wide, this step is already done — CADE uses your existing installation.

---

## Step 3: Configure Providers (`~/.cade/providers.toml`)

The provider configuration tells CADE which AI models to use for the chat panel and agent features. Create the file at `~/.cade/providers.toml`.

### Simplest setup — Claude Code only

If you only want the built-in Claude terminal (no separate API providers), create a minimal config:

```toml
default = "claude-code"

[provider.claude-code]
type = "claude-code"
```

This routes everything through the authenticated `claude` CLI.

### Full setup — API providers

For the LiteLLM API path (faster responses, multiple models, failover), add provider blocks for the services you have keys for. API keys can be set as environment variables (recommended) or written directly.

```toml
# Which provider to use by default
default = "mistral"

# ── Mistral ───────────────────────────────────────────────────────────────────
[provider.mistral]
type = "api"
model = "mistral/mistral-large-latest"
api-key = "${MISTRAL_API_KEY}"

# ── Cerebras (fast inference) ─────────────────────────────────────────────────
[provider.cerebras]
type = "api"
model = "cerebras/qwen-3-235b-a22b-instruct-2507"
api-key = "${CEREBRAS_API_KEY}"

# ── Groq ──────────────────────────────────────────────────────────────────────
[provider.groq]
type = "api"
model = "groq/openai/gpt-oss-120b"
api-key = "${GROQ_API_KEY}"

# ── Google Gemma ──────────────────────────────────────────────────────────────
[provider.gemma]
type = "api"
model = "gemini/gemma-3-27b-it"
api-key = "${GOOGLE_API_KEY}"

# ── MiniMax ───────────────────────────────────────────────────────────────────
[provider.minimax]
type = "api"
model = "anthropic/minimax-m2.7"
api-key = "${MINIMAX_API_KEY}"
api_base = "https://api.minimax.io/anthropic/v1/messages"

# ── Failover (tries primary, falls back down the list) ────────────────────────
[provider.adaptive]
type = "failover"
primary = "mistral"
fallbacks = ["cerebras", "groq", "gemma"]
```

You only need to add the providers you have keys for. Delete the rest.

### Setting API keys

**Option A — environment variables (recommended)**

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export MISTRAL_API_KEY="your-key-here"
export CEREBRAS_API_KEY="your-key-here"
export GROQ_API_KEY="your-key-here"
export GOOGLE_API_KEY="your-key-here"
export MINIMAX_API_KEY="your-key-here"
```

Then restart CADE.

**Option B — inline in providers.toml**

Replace `"${SOME_API_KEY}"` with the key directly:

```toml
api-key = "sk-abc123..."
```

> [!CAUTION]
> Inline keys are stored in plaintext. Do not commit `providers.toml` to version control if it contains keys.

### Where to get API keys

| Provider | Sign-up page |
|----------|-------------|
| Mistral | mistral.ai |
| Cerebras | cerebras.ai |
| Groq | console.groq.com |
| Google (Gemini/Gemma) | aistudio.google.com |
| MiniMax | minimax.io |

---

## Step 4: Verify the Installation

Open CADE. You should see:

1. The terminal panel launches a shell automatically
2. The chat panel accepts messages and streams a response
3. Typing `claude --version` in the terminal prints a version number

If the chat panel shows "Claude Code CLI not found" — run `claude login` (Step 2) and restart CADE.

---

## Optional: Anti-bot Web Browsing

CADE bundles `scout-browse`, a browser automation tool used by AI agents to fetch web pages that block plain HTTP requests. For full anti-bot capability it needs two additional things that must be set up manually.

### Google profile (persistent login cookies)

Scout-browse uses a dedicated Chrome profile to maintain Google login state across sessions. This allows agents to access Google Scholar, Google Drive, and other Google-authenticated pages.

1. Create the profile directory:

```bash
mkdir -p ~/.scout/profiles/google
```

2. Launch Chrome manually with this profile and log into your Google account:

```bash
# Linux
google-chrome --user-data-dir="$HOME/.scout/profiles/google"

# macOS
open -a "Google Chrome" --args --user-data-dir="$HOME/.scout/profiles/google"
```

3. Sign in to Google in the browser that opens, then close it.

From that point, `scout-browse` will use this profile for all headed sessions.

### NopeCHA CAPTCHA solver (optional)

NopeCHA is a browser extension that automatically solves CAPTCHAs. Without it, scout-browse will pause on CAPTCHA challenges.

1. Get a NopeCHA API key at nopecha.com
2. Download the extension: [nopecha.com/setup](https://nopecha.com/setup)
3. Extract the extension to `~/.scout/extensions/nopecha/`

```bash
mkdir -p ~/.scout/extensions/nopecha
# Extract the downloaded zip here
```

4. The extension is loaded automatically by `scout-browse` on next launch.

> [!NOTE]
> Without these steps, `scout-browse` still works for most pages. The Google profile and NopeCHA only matter when agents need to browse sites with strict anti-bot protection or Google authentication.

---

## Troubleshooting

**CADE opens but the terminal is blank**
Check that the shell command is correct. Open Settings → Terminal and verify the shell path. On Windows, ensure WSL is installed and `wsl` is available in `cmd`.

**"Provider not configured" error**
`~/.cade/providers.toml` is missing or has a syntax error. Check the file exists and is valid TOML (no stray quotes, correct indentation).

**API calls fail with authentication errors**
The API key in `providers.toml` is wrong or the environment variable is not set. Run `echo $MISTRAL_API_KEY` in a terminal to verify the variable is exported.

**claude login fails**
Ensure outbound HTTPS to `anthropic.com` is not blocked by a firewall or proxy.

**scout-browse doesn't load pages behind login**
The Google profile is not set up (Step 4 above), or cookies have expired. Re-run the Chrome profile setup.
