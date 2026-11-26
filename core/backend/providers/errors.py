"""Error codes for provider failures, and which ones are worth failing over.

`APIProvider` turns a LiteLLM exception into a `ChatError` code here, and
`FailoverProvider` reads the same code to decide whether another provider
might succeed. Keeping both sides in one module stops them drifting apart.
"""

from __future__ import annotations

import litellm

CODE_CONTEXT_WINDOW = "context-window-exceeded"
CODE_TIMEOUT = "timeout"
CODE_CONNECTION = "connection"
CODE_UNKNOWN = "unknown"

# Request timeout and rate limit. Every 5xx status also fails over.
_FAILOVER_STATUS_CODES = frozenset({"408", "429"})
_FAILOVER_CODES = _FAILOVER_STATUS_CODES | {CODE_TIMEOUT, CODE_CONNECTION}


def error_code(exc: BaseException) -> str:
    """Return the `ChatError` code for an exception from a provider call.

    LiteLLM exceptions carry the HTTP status as `status_code`. A context
    length error gets its own code first because it carries a 400 like any
    bad request, and callers may want to tell the two apart.
    """
    if isinstance(exc, litellm.ContextWindowExceededError):
        return CODE_CONTEXT_WINDOW
    status = getattr(exc, "status_code", None)
    if status is not None:
        return str(status)
    if isinstance(exc, TimeoutError):
        return CODE_TIMEOUT
    if isinstance(exc, ConnectionError):
        return CODE_CONNECTION
    return CODE_UNKNOWN


def is_failover_code(code: str) -> bool:
    """True when another provider could plausibly succeed where this one failed.

    Rate limits, server errors, timeouts and connection failures belong to
    one provider. A bad request, a bad key, a missing model or a prompt that
    is too long would fail the same way everywhere, so the user should see
    it straight away rather than after every provider has been tried.
    """
    if code in _FAILOVER_CODES:
        return True
    return len(code) == 3 and code.isdigit() and code.startswith("5")
