---
title: Multi-Provider LLM Failover and Load Balancing Strategies
created: 2026-04-28
tags: [research, providers, failover]
---

# Multi-Provider LLM Failover and Load Balancing Strategies

## Overview

When running production LLM workloads across multiple providers (OpenAI-compatible endpoints, Anthropic, Cerebras, Groq, Mistral, etc.), failures are inevitable. A robust multi-provider strategy addresses:

- **Failover**: recovering from provider outages without user-visible errors
- **Selection**: choosing the right provider/model for each request
- **Health monitoring**: detecting degraded providers before they exhaust retries
- **Cost control**: routing simple tasks to cheaper models

CADE's `FailoverProvider` (`core/backend/providers/failover_provider.py`) implements the foundational failover pattern. This doc surveys the broader design space to inform future enhancements.

---

## Provider Selection Strategies

Selection strategies determine which provider receives each request when multiple are available. Evidence tiers follow the PROVEN convention: meta-analysis > RCT > observational > opinion.

### Priority-Based (Ordered List)

**Evidence tier**: Observational / production practice

The simplest strategy: define a fixed ordering (primary, secondary, tertiary). Requests always go to the highest-priority healthy provider.

**Pros**: Simple, predictable, easy to reason about
**Cons**: Underutilizes secondary capacity; primary bears all load

CADE's `FailoverProvider` uses this approach — providers are tried in order from the constructor list.

### Round-Robin

**Evidence tier**: Observational / standard load balancing

Distribute requests evenly across providers. Suitable when providers have equal capability and cost.

**Pros**: Good utilization when providers are equal; simple to implement
**Cons**: Ignores latency, cost, and current load; can route to a degraded provider

**Implementation notes**: Requires provider health awareness to skip unhealthy nodes. Round-robin alone is insufficient for production LLM workloads where failure recovery time matters.

### Least-Latency

**Evidence tier**: Observational

Route to the provider with the lowest recent average latency. Requires per-provider latency tracking (rolling window of recent requests).

**Pros**: Reduces user-perceived latency
**Cons**: Latency is noisy; a single slow request can skew a window; cost is ignored

### Cost-Optimized (Task-Aware Routing)

**Evidence tier**: Meta-analysis of routing research (2502.00409, 2502.18482, 2510.08439, 2509.14899)

Route requests to the cheapest model capable of handling the task. This is the most active area of LLM routing research.

| Paper | Approach | Key Finding |
|-------|----------|-------------|
| MixLLM (2502.18482) | Contextual bandit with lightweight quality/cost estimators | Achieves high quality at significantly reduced cost via dynamic query assignment |
| xRouter (2510.08439) | Reinforcement-learning-trained router with explicit cost-aware reward | Substantial cost reduction while maintaining task completion rates |
| CARGO (2509.14899) | Two-stage: embedding regressor + optional binary classifier | 76.4% top-1 routing accuracy; 72–89% win rate vs. single expert models |
| Extended Survey (2502.00409) | Taxonomy of routing strategies | Fine-tuned smaller models can route to APIs; post-generation uncertainty routing viable |

**Pros**: Dramatic cost reduction (30–70% in published benchmarks)
**Cons**: Requires labeled data or learned estimators; complexity; accuracy not guaranteed

### Confidence-Aware (Hybrid)

**Evidence tier**: Primary research (2509.14899)

CARGO's approach: use predicted quality score to decide whether a single model is likely sufficient, or whether a binary classifier is needed to choose between candidates.

```python
# Conceptual: confidence threshold routing
if top_score - second_score >= confidence_threshold:
    route_to(top_model)
else:
    use_binary_classifier(top_model, second_model)
```

---

## Health Checking and Circuit Breaker Patterns

Health checking detects provider degradation before it causes cascading failures. Circuit breakers stop routing traffic to failed providers and periodically test for recovery.

### Circuit Breaker States

| State | Behaviour |
|-------|-----------|
| **Closed** | Normal operation; requests flow through. Failures are counted. |
| **Open** | All requests fail fast. No calls made to the provider. After cooldown, transitions to **half-open**. |
| **Half-open** | One probe request allowed. If it succeeds, transition to closed. If it fails, return to open. |

CADE's `FailoverProvider` implements a simplified circuit breaker:

- **Cooldown tracking**: `_cooldowns` dict maps provider names to `(expiry_timestamp, cooldown_seconds)`
- **Exponential backoff**: cooldowns double on each failure (`_BACKOFF_FACTOR = 2.0`), capped at 10 minutes
- **Best-effort recovery**: when all providers are in cooldown, the primary is retried anyway

### Health Signals

Production systems should monitor:

| Signal | Threshold (typical) | Notes |
|--------|---------------------|-------|
| Error rate | >10% over rolling window | Exclude 4xx client errors |
| Latency | >P95 threshold (e.g., 30s) | Per-provider rolling window |
| Rate limit hits | >3 in 60s | Indicates quota stress |
| Timeout rate | >20% | Separate from explicit errors |

### Passive vs. Active Health Checking

**Passive**: Failures are detected during normal request processing. CADE's `FailoverProvider` uses this — errors during `stream_chat` mark a provider as unhealthy.

**Active**: A background task periodically sends probe requests (e.g., a lightweight completion) to measure latency and error rate. This catches degraded providers before they cause user-visible failures.

**Recommendation for CADE**: Add a background health-check task that issues a single-token probe to each provider every 60 seconds. Use the results to mark providers as healthy/degraded before a user request is needed.

---

## Failover Trigger Thresholds and Logic

### When to Fail Over

`FailoverProvider` triggers failover on:

1. **Pre-output `ChatError`**: provider yields an error before yielding any `TextDelta`
2. **Exception during stream**: any unhandled exception during `stream_chat`

Post-output errors (after first `TextDelta`) are propagated as-is — the stream cannot be recovered.

### Error Classification

Not all errors should trigger failover. A taxonomy:

| Error Type | Failover? | Reason |
|------------|-----------|--------|
| Network timeout | Yes | Provider unreachable; likely transient |
| 429 Rate Limited | Yes | Provider is overloaded; cooldown appropriate |
| 500 Internal Error | Yes | Provider-side issue; transient |
| 400 Bad Request | No | Request malformed; retrying won't help |
| 401 Unauthorized | No | API key issue; permanent |
| 429 with `Retry-After` | Configurable | May be worth short immediate retry |

**Implementation note**: `FailoverProvider` currently treats all pre-output `ChatError` and exceptions as failover triggers. Distinguishing error codes (400 vs 429 vs 500) would allow smarter routing — e.g., skip cooldown on 400 but apply cooldown on 429.

### Timeout Thresholds

| Threshold | Recommended Value | Notes |
|-----------|-------------------|-------|
| First byte timeout | 30–60s | Generous; LLMs can be slow to start |
| Per-token timeout | 10–30s | Catch stuck streams |
| Overall stream timeout | 180–300s | Task-dependent; code tasks need more time |

LiteLLM handles timeouts at the transport layer. CADE's `FailoverProvider` does not currently set per-request timeouts — this is delegated to LiteLLM defaults.

---

## Cost-Aware Routing

### Tiered Model Strategy

The most practical cost-aware approach for CADE:

| Task Complexity | Example | Preferred Model | Fallback |
|----------------|---------|-----------------|----------|
| Simple factual | "What year did X happen?" | `gpt-4o-mini` / `claude-3-haiku` | `gpt-4o` / `claude-3.5-sonnet` |
| Moderate | Summarization, extraction | `gpt-4o-mini` | `claude-3.5-sonnet` |
| Complex reasoning | Code generation, analysis | `claude-3.7-sonnet` / `gpt-4.1` | Primary + FailoverProvider |

### Simple Complexity Heuristics

Without a trained router, heuristic routing can achieve meaningful savings:

1. **Token count**: requests <256 tokens often simple
2. **Keyword detection**: presence of "analyze", "code", "reason" → route to capable model
3. **System prompt length**: longer system prompts imply complex task

### Cost Tracking

`ChatDone` events include a `usage` dict and `cost` field. Accumulate these to make routing decisions:

```python
# Per-request cost estimation (approximate)
COSTS = {
    "gpt-4o-mini": 0.0015,  # $/1K input tokens
    "claude-3.5-sonnet": 0.003,
}

def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rate = COSTS.get(model, 0.003)
    return rate * (input_tokens / 1000) + rate * (output_tokens / 1000) * 1.5
```

---

## API Semantic Differences Across Providers

| Provider | API Style | Rate Limits | Error Codes | Notes |
|----------|-----------|-------------|-------------|-------|
| OpenAI-compatible | OpenAI chat completions | Per-model RPM/TPM | 400, 401, 403, 429, 500, 503 | Standard; LiteLLM handles |
| Anthropic | Extended `messages` API | Account-level | `400 INVALID_REQUEST`, `401 AUTHENTICATION_ERROR`, `429` with `类型` | Different streaming format; `usage.prompt_tokens` in first chunk |
| Cerebras | OpenAI-compatible | Generous | Similar to OpenAI | Latency-optimized; cheaper |
| Groq | OpenAI-compatible | Per-model burst limits | `429 RATE_LIMIT_EXCEEDED` | Very fast; brief rate limit windows |
| Mistral | OpenAI-compatible | Per-model | Similar to OpenAI | La Plateforme has separate limits |

### Provider-Specific Considerations

- **Anthropic's streaming**: prompt tokens arrive in `message_start` event, not `message_delta`. `APIProvider` accumulates these in `accumulated_prompt_tokens` to ensure correct usage reporting.
- **Rate limit 429 handling**: LiteLLM retries 429s with `Retry-After` headers by default. `FailoverProvider` should also back off on rate limit errors rather than immediately retrying the next provider.
- **Region-specific endpoints**: Cerebras and AWS Bedrock require region configuration. LiteLLM routes based on model prefix.

---

## Rate Limiting and Quota Management

### Types of Limits

| Limit Type | Scope | Typical Value |
|-----------|-------|---------------|
| RPM (requests per minute) | Per API key | 60–500 |
| TPM (tokens per minute) | Per API key | 30K–150K |
| Burst | Per endpoint | 10–20 concurrent |
| Daily quota | Account | Provider-specific |

### Strategies

**Token bucket**: track per-provider token usage with a rolling window. Reject or queue requests when TPM is exceeded. Allows burst traffic while enforcing average limits.

**Request counting**: simpler, less accurate. Count requests and apply RPM limit.

**Per-provider queues**: isolate each provider's traffic so one provider's rate limit doesn't affect others. Combined with `FailoverProvider` wrapping individual providers, each provider has independent rate limit protection.

### Integration with FailoverProvider

`FailoverProvider` currently has no rate limit awareness. Enhancement opportunity:

1. Track per-provider request counts
2. On rate limit error (429), mark provider as failed with cooldown proportional to `Retry-After` header
3. Expose provider health stats so operators can see which providers are rate-limited

---

## Recovery and Back-Off Strategies

### Exponential Backoff

`FailoverProvider` uses exponential backoff with:
- **Initial cooldown**: 60 seconds
- **Backoff factor**: 2.0× per failure
- **Max cooldown**: 600 seconds (10 minutes)

After a successful stream, the cooldown is cleared.

### Jitter

Pure exponential backoff causes synchronized retry storms when multiple clients reconnect simultaneously. Adding jitter spreads retries:

```
cooldown = min(base_cooldown * (backoff_factor ** failure_count) * random.uniform(0.5, 1.5), max_cooldown)
```

**Recommendation**: Add jitter to `_mark_failed()` when multiple clients share the same provider configuration.

### Recovery Detection

| Approach | Mechanism | Accuracy |
|----------|-----------|----------|
| Probe-based | Background task sends test request every N seconds | High; catches silent degradation |
| Passive | Next real request after cooldown expires tests the provider | Depends on request volume |
| Hybrid | Passive with occasional probe requests | Best of both |

---

## Integration Notes for FailoverProvider

### Current Implementation

`FailoverProvider` (`core/backend/providers/failover_provider.py`) wraps an ordered list of `BaseProvider` instances and provides:

- Sequential failover on pre-output errors
- Exponential-backoff cooldown per provider
- Best-effort recovery when all providers in cooldown
- Event stream passthrough (yields events from working provider)

### Extensibility Points

| Enhancement | Where to Implement | Notes |
|-------------|---------------------|-------|
| Error code filtering | `_mark_failed()` | Distinguish 400 (no failover) from 429/500 (failover + cooldown) |
| Active health checking | New `HealthCheckProvider` or background task | Probe providers periodically; update `_cooldowns` proactively |
| Round-robin selection | New `RoundRobinFailoverProvider` subclass | Track index into provider list |
| Cost-aware routing | New `CostAwareProvider` wrapping `FailoverProvider` | Complexity classifier → model selector |
| Jitter on backoff | `_mark_failed()` | Add `random.uniform(0.5, 1.5)` to cooldown |
| Rate limit tracking | New `RateLimitTracker` | Track RPM/TPM per provider; route around exhausted providers |

### Wiring with LiteLLM

`APIProvider` delegates to LiteLLM, which handles transport-level retries for 429 and 503 errors. `FailoverProvider` operates one layer above — if LiteLLM exhausts its internal retries and raises an exception, `FailoverProvider` catches it and fails over.

---

## Key Sources

| Citation | Source |
|----------|--------|
| (MixLLM, 2025, *arXiv:2502.18482*) | Dynamic contextual-bandit LLM routing with quality/cost tradeoff |
| (xRouter, 2025, *arXiv:2510.08439*) | RL-trained cost-aware routing system for tool-calling LLMs |
| (CARGO, 2025, *arXiv:2509.14899*) | Confidence-aware two-stage routing; 76.4% top-1 accuracy |
| (Extended Survey, 2025, *arXiv:2502.00409*) | Comprehensive taxonomy of LLM routing strategies |
| (vLLM Semantic Router, 2026, *arXiv:2603.04444*) | Signal-driven routing with Boolean policy composition |
| (Circuit Breakers, 2016, *arXiv:1609.05830*) | Systematic review of circuit breaker patterns in microservices |
| (Resilient Microservices, 2025, *arXiv:2512.16959*) | Recovery patterns and evaluation frameworks for distributed systems |
| (SkyWalker, 2025, *arXiv:2505.24095*) | Cross-region load balancing for LLM inference |

---

## See Also

- [[../technical/core/provider-architecture]] — Provider abstraction and LiteLLM integration
- [[../technical/reference/api-provider]] — APIProvider implementation details
- [[../technical/design/visual-design-philosophy]] — Theme system (unrelated but in same reference dir)
- `core/backend/providers/failover_provider.py` — FailoverProvider source
- `core/backend/providers/api_provider.py` — APIProvider source
- `core/backend/providers/config.py` — Provider configuration
