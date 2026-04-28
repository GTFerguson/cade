---
title: Brand Voice Guide — How to Write a Brand YAML
created: 2026-04-27
updated: 2026-04-27
status: active
tags: [socials, brand-voice, yaml, guide]
---

# Brand Voice Guide

How to add or edit a brand in the socials pipeline. Brand configs live in `src/socials/brands/` — one YAML file per brand. The file name becomes the brand ID.

## File structure

```
src/socials/brands/
  gary.yaml
  goodlet.yaml
  padarax.yaml
  tensyl.yaml
```

## YAML schema

```yaml
name: Human-readable brand name
colour: '#hexcolour'            # used in dashboard UI
default_voices: [voice_id_1, voice_id_2]   # ordered — first is primary

prompt: |
  ## Brand: Name (type)

  Read /path/to/product-brief.md for ...
  Read /path/to/research.md for ...

  ## Socials voice

  CHARACTER: ...
  TONE: ...
  WHAT [BRAND] TALKS ABOUT: ...
  WHAT [BRAND] NEVER DOES: ...

voices:
  brand_platform:
    platform: x          # x | linkedin | instagram | reddit | bluesky | youtube | blog
    max_chars: 280        # null for youtube/blog
    format: single        # single | thread | carousel | video_script | blog_post
    api_mode: manual      # manual (copy-paste) | api (auto-post)
    voice: |
      Voice string here...
    subreddits: [r/foo, r/bar]   # reddit only, optional
```

## The `prompt:` block

This is the brand-layer system prompt the writer agent receives. It has two jobs:

**1. Point to source material.** The agent reads product briefs and research docs before writing. Use absolute paths.

```yaml
prompt: |
  Read /home/gary/projects/business-manager/docs/products/goodlet.md for the full product brief.
  Read /home/gary/projects/goodlet/docs/reference/market/renter-priorities-and-apis.md for what renters care about.
```

**2. Define the voice.** After the Read lines, write the character, tone rules, and guardrails. These sections work well:

- `CHARACTER:` — one paragraph, who is this voice, what's their origin story
- `TONE:` — register, energy level, what it sounds like
- `WHAT [BRAND] TALKS ABOUT:` — concrete topics with examples
- `WHAT [BRAND] NEVER DOES:` — the exact phrases and framings to reject
- `BANNED PHRASES:` — a literal list if the brand has specific language allergies
- `FRAMING RULE:` — a rule that resolves ambiguous cases (e.g. "say tradeoffs, not superlatives")
- `PLATFORM SPLIT:` — if tone differs materially between X and Reddit, say so here

Keep the prompt factual and instructional. The agent follows these rules directly — vague guidance produces vague posts.

## The `voice:` string

The voice string layers on top of the brand prompt. It's platform-specific and operational — constraints the writer should follow for this particular voice.

**Good voice strings are:**
- Specific about what to lead with ("Lead with the player-facing story, not the mechanism")
- Specific about what to reject ("Never: 'LLM-powered', 'AI dungeon master'")
- Aware of the platform's audience ("Bluesky skews indie dev and narrative game fans")
- Short. The brand prompt already carries the character — the voice string adds platform constraints.

**Bad voice strings:**
- Restate the brand character ("Builder voice, direct, honest") — that's in the prompt
- Too vague ("Be authentic and engaging") — gives the agent no real instruction
- Too long — if it's > 5 sentences, move the general content to the brand prompt

## Adding a new brand

1. Create `src/socials/brands/<brand-id>.yaml`
2. Set `colour` to match the brand's primary colour
3. Write the `prompt:` — start with Read pointers to existing product docs, then add voice rules
4. Add at least one voice config under `voices:`
5. Set `default_voices` to the voice IDs in priority order
6. Add the brand colour to dashboard.html's `:root` CSS (`--clr-<brand-id>: #hex`)
7. Add a brand nav item in the sidebar's Brands group
8. Add `BRIEF_BRAND_CONFIG.<brand-id>` in the brief modal JS

## Adding a new voice to an existing brand

Add a new key under `voices:` in the brand YAML. The key becomes the voice ID (used in `VOICE_ROUTING` and `BRAND_DEFAULT_VOICES`). If it should be a default voice, add it to `default_voices`.

## What the loader does

`voices.py` scans `brands/*.yaml` at import time and builds `VOICES` and `BRAND_DEFAULT_VOICES` automatically. `prompts.py` builds `BRAND_PROMPTS` from the same files. No code changes needed when adding a brand or voice — only YAML.
