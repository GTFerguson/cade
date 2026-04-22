---
title: Context Budget Indicator UI
created: 2026-04-22
status: planning
---

# Context Budget Indicator

Real-time visualization of token usage in the chat pane, allowing users to make informed handoff decisions.

## Overview

Display a compact progress bar in the bottom-right of the chat pane showing context window usage as a percentage of the model's token limit. Users can trigger `/handoff` manually when they see the gauge approaching capacity.

## Design

### Visual Style
- **Aesthetic**: Matches the splash screen loading bar (segmented blocks), but smaller
- **Location**: Bottom-right corner of chat pane
- **Size**: ~8 blocks (segments), approximately 80-120px wide
- **Height**: ~4-6px (thin bar)

### Color Progression
| Usage | Color | Meaning |
|-------|-------|---------|
| 0-50% | Soft blue | Plenty of context available |
| 50-75% | Green | Approaching midpoint, monitor usage |
| 75-90% | Orange/Yellow | Approaching capacity, consider handoff |
| 90-100% | Red | Danger zone, handoff recommended |

### Data Source
- **Token usage**: Cumulative tokens used in current session (from litellm responses)
- **Model limit**: From provider config or litellm model info
- **Update frequency**: After each model response (per ChatDone event with usage data)
- **Initial state**: Hidden until first response with usage info arrives

## Interaction

### User Triggered
- Users watch the gauge as they work
- When gauge enters yellow/orange (75%+), user is warned to consider handoff
- User can trigger `/handoff` at any time to generate a brief and spawn a new agent
- Handoff is manual and task-dependent (no automation)

### Configuration
- **`context_budget_threshold`** (config key): Optional percentage (default: 75%) at which to show visual warning
- **`context_budget_hard_limit`** (config key): Optional percentage (default: 90%) for danger color
- Setting can disable the indicator entirely if desired

## Implementation Details

### Frontend Changes
- `frontend/src/chat/chat-pane.ts`: Add progress bar component
- `frontend/src/components/context-budget-indicator.ts`: New component for rendering
- Update ChatDone event handler to extract usage data and update gauge

### Backend Changes
- Ensure `_extract_usage()` in APIProvider captures usage consistently
- Pass usage info in every ChatDone event (even if no usage available, include zeros)

### Calculation
```
percentage = (tokens_used / model_token_limit) × 100
```

### Config Example
```toml
[provider.claude-opus]
type = "api"
model = "claude-3-5-opus-20241022"
context_budget_threshold = 75  # Show warning at 75%
context_budget_hard_limit = 90  # Danger zone at 90%
```

## Edge Cases

- **No usage data**: If model doesn't return usage, don't show gauge (or show as unknown)
- **Unknown model limit**: If limit can't be determined, hide gauge with graceful fallback
- **First response**: Gauge may appear mid-conversation; show only after first usage data received
- **Model switch**: If user switches providers, gauge resets with new model's context window

## Future Enhancements

- Tooltip showing exact token count (e.g., "2,450 / 200,000 tokens")
- Predictive indicator showing estimated tokens for pending response
- Historical graph of context usage over time (for learning patterns)
