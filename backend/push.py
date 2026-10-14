"""Web Push for attention events.

Lets an installed CADE web app on a phone get a lock-screen notification
when an agent is waiting for input, without the page being open. Keys and
subscriptions live under ``~/.cade/push/`` so they survive restarts and
are never part of a project.

``pywebpush`` is imported lazily: without it push is simply off and the
rest of the backend is unaffected.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

PUSH_DIR_NAME = "push"
VAPID_KEY_FILENAME = "vapid_private.pem"
SUBSCRIPTIONS_FILENAME = "subscriptions.json"
# Each attention push is replaced by the next one for the same session, so
# the lock screen never stacks up stale "waiting for you" notifications.
PUSH_TTL_SECONDS = 600


def push_available() -> bool:
    try:
        import pywebpush  # noqa: F401
        import py_vapid  # noqa: F401
    except ImportError:
        return False
    return True


class PushService:
    def __init__(self, cade_dir: Path) -> None:
        self._dir = cade_dir / PUSH_DIR_NAME
        self._lock = threading.Lock()
        self._subscriptions: list[dict] | None = None

    # -- keys ---------------------------------------------------------------

    def _vapid(self):
        from py_vapid import Vapid

        key_path = self._dir / VAPID_KEY_FILENAME
        if key_path.exists():
            return Vapid.from_file(str(key_path))
        self._dir.mkdir(parents=True, exist_ok=True)
        vapid = Vapid()
        vapid.generate_keys()
        vapid.save_key(str(key_path))
        try:
            key_path.chmod(0o600)
        except OSError:
            pass
        logger.info("Generated VAPID key pair at %s", key_path)
        return vapid

    def public_key(self) -> str | None:
        """Base64url-encoded uncompressed P-256 public key, as the browser wants it."""
        if not push_available():
            return None
        import base64

        from cryptography.hazmat.primitives import serialization

        vapid = self._vapid()
        raw = vapid.public_key.public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    # -- subscriptions --------------------------------------------------------

    def _load(self) -> list[dict]:
        if self._subscriptions is not None:
            return self._subscriptions
        path = self._dir / SUBSCRIPTIONS_FILENAME
        try:
            self._subscriptions = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self._subscriptions = []
        return self._subscriptions

    def _save(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        path = self._dir / SUBSCRIPTIONS_FILENAME
        path.write_text(json.dumps(self._subscriptions or [], indent=2), encoding="utf-8")

    def subscribe(self, subscription: dict, device: str | None = None) -> int:
        """Store a browser's PushSubscription JSON; returns the subscription count."""
        endpoint = subscription.get("endpoint")
        if not isinstance(endpoint, str) or not endpoint:
            raise ValueError("subscription has no endpoint")
        with self._lock:
            subs = [s for s in self._load() if s.get("subscription", {}).get("endpoint") != endpoint]
            subs.append({
                "subscription": subscription,
                "device": device or "",
                "created": time.time(),
            })
            self._subscriptions = subs
            self._save()
            return len(subs)

    def unsubscribe(self, endpoint: str) -> int:
        with self._lock:
            subs = [s for s in self._load() if s.get("subscription", {}).get("endpoint") != endpoint]
            self._subscriptions = subs
            self._save()
            return len(subs)

    def subscription_count(self) -> int:
        return len(self._load())

    # -- sending --------------------------------------------------------------

    def send_sync(self, payload: dict) -> int:
        """Deliver ``payload`` to every subscription; returns deliveries made.

        Subscriptions the push service reports gone (404/410) are dropped.
        """
        if not push_available():
            return 0
        from pywebpush import WebPushException, webpush

        vapid = self._vapid()
        private_key_path = str(self._dir / VAPID_KEY_FILENAME)
        body = json.dumps(payload)
        delivered = 0
        gone: list[str] = []
        for entry in list(self._load()):
            sub = entry.get("subscription", {})
            try:
                webpush(
                    subscription_info=sub,
                    data=body,
                    vapid_private_key=private_key_path,
                    vapid_claims={"sub": "mailto:cade@localhost"},
                    ttl=PUSH_TTL_SECONDS,
                )
                delivered += 1
            except WebPushException as e:
                status = getattr(getattr(e, "response", None), "status_code", None)
                if status in (404, 410):
                    gone.append(sub.get("endpoint", ""))
                else:
                    logger.warning("Push to %s failed: %s", entry.get("device") or "device", e)
            except Exception as e:  # noqa: BLE001
                logger.warning("Push failed: %s", e)
        del vapid
        for endpoint in gone:
            self.unsubscribe(endpoint)
        return delivered

    async def send(self, payload: dict) -> int:
        if not self._load():
            return 0
        return await asyncio.get_event_loop().run_in_executor(None, self.send_sync, payload)


_service: PushService | None = None


def get_push_service() -> PushService:
    global _service
    if _service is None:
        _service = PushService(Path.home() / ".cade")
    return _service


def set_push_service(service: PushService | None) -> None:
    global _service
    _service = service
