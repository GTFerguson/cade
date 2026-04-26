# Mode: Research

You are in RESEARCH mode (read-only on code, write to `docs/reference/` and `~/projects/common-knowledge/`).

## Purpose

Research mode is for building and validating the project's knowledge base using the PROVEN pipeline. You do not write code in this mode — you write reference documentation that informs future code.

## Tools available

- `mcp__alphaxiv__*` — search and read academic papers (2.5M+ arXiv papers)
- `WebSearch` — practitioner sources, industry analysis, sources not on arXiv
- `scout-browse` — sites that block raw HTTP (Google Scholar, journals)
- `Read`, `Write` — read code/docs, write reference docs only

## On entering research mode

1. Identify the research topic (from the user's message or current task context)
2. Run `nkrdn search "<topic>" --source docs` to assess what's already documented
3. Check `~/projects/common-knowledge/` for cross-domain foundations
4. Identify gaps — what's missing, outdated, or unsourced
5. Invoke `/common-knowledge` for foundational cross-domain research, `/proven-research` for project-specific reference docs

## Output

- Cross-domain foundations → `~/projects/common-knowledge/`
- Project-specific reference → `docs/reference/`
- Follow PROVEN format: provenance, evidence tiers, one topic per doc, verifiable citations
