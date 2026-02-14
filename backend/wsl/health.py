"""WSL health checking and auto-recovery.

Detects when WSL is in a bad state and attempts automatic recovery.
"""

from __future__ import annotations

import logging
import subprocess
import time

from backend.subprocess_utils import run_silent

logger = logging.getLogger(__name__)

# Known WSL error patterns that indicate WSL infrastructure failure
WSL_ERROR_PATTERNS = [
    "failed to translate",
    "createprocesscommon",
    "wsl.exe exited",
    "the windows subsystem for linux has not been enabled",
    "wslregisterdistribution",
    "element not found",
    "access is denied",
    "the service has not been started",
    "distribution failed to start",
    "error code",
]


def is_wsl_error(error_message: str) -> bool:
    """Check if an error message indicates a WSL infrastructure failure."""
    error_lower = error_message.lower()
    return any(pattern in error_lower for pattern in WSL_ERROR_PATTERNS)


def check_wsl_health(timeout: float = 15.0) -> tuple[bool, str]:
    """
    Check if WSL is responsive by running a simple command.

    Returns:
        Tuple of (is_healthy, message)
    """
    try:
        result = run_silent(
            ["wsl", "echo", "ok"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode == 0 and "ok" in result.stdout:
            return True, "WSL is healthy"
        return False, f"WSL returned: {result.stderr or result.stdout}"
    except subprocess.TimeoutExpired:
        return False, "WSL health check timed out"
    except FileNotFoundError:
        return False, "WSL not installed"
    except Exception as e:
        return False, f"WSL health check failed: {e}"


def restart_wsl(timeout: float = 60.0) -> tuple[bool, str]:
    """
    Restart WSL by shutting it down and waiting for it to come back up.

    Returns:
        Tuple of (success, message)
    """
    logger.info("Restarting WSL...")

    try:
        # Shutdown WSL
        shutdown_result = run_silent(
            ["wsl", "--shutdown"],
            capture_output=True,
            text=True,
            timeout=15.0,
        )

        if shutdown_result.returncode != 0:
            return False, f"WSL shutdown failed: {shutdown_result.stderr}"

        logger.debug("WSL shutdown complete, waiting for restart...")

        # Give WSL time to fully shut down before attempting restart
        time.sleep(3)

        # Exponential backoff for health checks
        # Severely broken WSL states can take longer to recover
        wait_times = [1, 2, 4, 8, 8, 8, 8, 8]  # ~47 seconds total
        start_time = time.time()
        last_error = ""

        for wait in wait_times:
            if time.time() - start_time >= timeout:
                break
            healthy, msg = check_wsl_health(timeout=10.0)
            if healthy:
                logger.info("WSL restarted successfully")
                return True, "WSL restarted successfully"
            last_error = msg
            logger.debug("WSL not ready yet, waiting %ds...", wait)
            time.sleep(wait)

        return False, f"WSL failed to restart: {last_error}"

    except subprocess.TimeoutExpired:
        return False, "WSL shutdown timed out"
    except Exception as e:
        return False, f"WSL restart failed: {e}"


def check_wsl_network(timeout: float = 10.0) -> tuple[bool, str]:
    """
    Check if WSL has network connectivity to reach the internet.

    Specifically checks if api.anthropic.com is reachable, which is required
    for Claude Code to function.

    Returns:
        Tuple of (is_connected, message)
    """
    try:
        # Try DNS resolution first (fastest and most reliable check)
        # Using getent which is more universal than nslookup
        result = run_silent(
            ["wsl", "bash", "-c", "getent hosts api.anthropic.com >/dev/null 2>&1"],
            capture_output=True,
            timeout=min(timeout, 5.0),
        )

        if result.returncode == 0:
            return True, "WSL network is ready (DNS working)"

        # Fall back to ping if getent fails
        result = run_silent(
            ["wsl", "bash", "-c", "ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1"],
            capture_output=True,
            timeout=min(timeout, 3.0),
        )

        if result.returncode == 0:
            # Network works but DNS might not - still considered ready
            return True, "WSL network is ready (ping working)"

        return False, "WSL network not ready - cannot resolve DNS or ping"

    except subprocess.TimeoutExpired:
        return False, "WSL network check timed out"
    except FileNotFoundError:
        return False, "WSL not found"
    except Exception as e:
        return False, f"WSL network check failed: {e}"


def wait_for_wsl_network(max_wait: float = 15.0, check_interval: float = 1.0) -> tuple[bool, str]:
    """
    Wait for WSL network to be ready, checking periodically.

    Args:
        max_wait: Maximum time to wait in seconds
        check_interval: How often to check in seconds

    Returns:
        Tuple of (is_ready, message)
    """
    start_time = time.time()
    last_error = ""

    logger.debug("Waiting for WSL network readiness...")

    while time.time() - start_time < max_wait:
        ready, msg = check_wsl_network(timeout=check_interval + 2)
        if ready:
            elapsed = time.time() - start_time
            logger.info("WSL network ready after %.1fs", elapsed)
            return True, msg

        last_error = msg
        logger.debug("WSL network not ready yet: %s (%.1fs elapsed)", msg, time.time() - start_time)
        time.sleep(check_interval)

    return False, f"WSL network not ready after {max_wait}s: {last_error}"


def ensure_wsl_ready(max_retries: int = 2) -> tuple[bool, str]:
    """
    Ensure WSL is ready for use, restarting if necessary.

    Args:
        max_retries: Number of restart attempts if WSL is unhealthy

    Returns:
        Tuple of (ready, message)
    """
    # First, check current health
    healthy, msg = check_wsl_health()
    if healthy:
        logger.debug("WSL health check passed")
        return True, msg

    logger.warning("WSL health check failed: %s", msg)

    # Try to recover
    for attempt in range(max_retries):
        logger.info("WSL recovery attempt %d of %d", attempt + 1, max_retries)

        success, restart_msg = restart_wsl()
        if success:
            return True, restart_msg

        logger.warning("WSL recovery attempt %d failed: %s", attempt + 1, restart_msg)

    return False, f"WSL recovery failed after {max_retries} attempts: {msg}"
