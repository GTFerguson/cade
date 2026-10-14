"""Tests for Web Push subscription storage and delivery."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from backend.push import PushService, push_available


def sub(endpoint: str) -> dict:
    return {"endpoint": endpoint, "keys": {"p256dh": "x", "auth": "y"}}


class TestSubscriptions:
    def test_subscribe_dedupes_by_endpoint_and_persists(self, temp_dir: Path):
        svc = PushService(temp_dir)
        assert svc.subscribe(sub("https://push/1"), "phone") == 1
        assert svc.subscribe(sub("https://push/1"), "phone again") == 1
        assert svc.subscribe(sub("https://push/2"), "tablet") == 2

        fresh = PushService(temp_dir)
        assert fresh.subscription_count() == 2

    def test_unsubscribe(self, temp_dir: Path):
        svc = PushService(temp_dir)
        svc.subscribe(sub("https://push/1"))
        assert svc.unsubscribe("https://push/1") == 0

    def test_rejects_subscription_without_endpoint(self, temp_dir: Path):
        with pytest.raises(ValueError):
            PushService(temp_dir).subscribe({"keys": {}})


@pytest.mark.skipif(not push_available(), reason="pywebpush not installed")
class TestDelivery:
    def test_public_key_is_stable_base64url(self, temp_dir: Path):
        svc = PushService(temp_dir)
        key = svc.public_key()
        assert key and "=" not in key and "+" not in key
        assert PushService(temp_dir).public_key() == key

    def test_send_drops_gone_subscriptions(self, temp_dir: Path):
        from pywebpush import WebPushException

        svc = PushService(temp_dir)
        svc.subscribe(sub("https://push/alive"))
        svc.subscribe(sub("https://push/gone"))

        class Resp:
            status_code = 410

        def fake_webpush(subscription_info, **_):
            if subscription_info["endpoint"].endswith("gone"):
                raise WebPushException("gone", response=Resp())

        with patch("pywebpush.webpush", side_effect=fake_webpush):
            delivered = svc.send_sync({"title": "t"})

        assert delivered == 1
        assert svc.subscription_count() == 1

    @pytest.mark.asyncio
    async def test_send_without_subscriptions_is_free(self, temp_dir: Path):
        svc = PushService(temp_dir)
        with patch.object(svc, "send_sync") as send_sync:
            assert await svc.send({"title": "t"}) == 0
            send_sync.assert_not_called()
