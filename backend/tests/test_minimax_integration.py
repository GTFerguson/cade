"""Live MiniMax integration tests — skipped unless MINIMAX_API_KEY is set.

Run manually:
    source ~/.cade/.env && pytest backend/tests/test_minimax_integration.py -v
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MINIMAX_API_KEY"),
    reason="MINIMAX_API_KEY not set",
)

API_BASE = "https://api.minimax.io/anthropic/v1/messages"
OPENAI_BASE = "https://api.minimax.io/v1"


@pytest.fixture
def minimax_key() -> str:
    return os.environ["MINIMAX_API_KEY"]


@pytest.mark.asyncio
async def test_anthropic_model_with_anthropic_endpoint_streams(minimax_key: str):
    """User's providers.toml pairing: anthropic/minimax-m2.7 + /anthropic/v1/messages."""
    import litellm

    litellm.suppress_debug_info = True
    resp = await litellm.acompletion(
        model="anthropic/minimax-m2.7",
        messages=[{"role": "user", "content": "Reply ok"}],
        api_key=minimax_key,
        api_base=API_BASE,
        extra_headers={"Authorization": f"Bearer {minimax_key}"},
        max_tokens=64,
        stream=True,
    )
    chunks = [c async for c in resp]
    assert chunks


@pytest.mark.asyncio
async def test_minimax_model_with_anthropic_endpoint_fails(minimax_key: str):
    """Switching only the model string (without changing api_base) 404s."""
    import litellm

    litellm.suppress_debug_info = True
    with pytest.raises(Exception) as exc:
        resp = await litellm.acompletion(
            model="minimax/MiniMax-M2.7",
            messages=[{"role": "user", "content": "Reply ok"}],
            api_key=minimax_key,
            api_base=API_BASE,
            extra_headers={"Authorization": f"Bearer {minimax_key}"},
            max_tokens=64,
            stream=True,
        )
        async for _ in resp:
            pass
    assert "404" in str(exc.value)


@pytest.mark.asyncio
async def test_minimax_model_with_openai_endpoint_streams(minimax_key: str):
    """OpenAI-format path: minimax/MiniMax-M2.7 + /v1."""
    import litellm

    litellm.suppress_debug_info = True
    resp = await litellm.acompletion(
        model="minimax/MiniMax-M2.7",
        messages=[{"role": "user", "content": "Reply ok"}],
        api_key=minimax_key,
        api_base=OPENAI_BASE,
        extra_headers={"Authorization": f"Bearer {minimax_key}"},
        max_tokens=64,
        stream=True,
    )
    chunks = [c async for c in resp]
    assert chunks
