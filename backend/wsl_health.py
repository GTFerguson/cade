"""WSL health checking and auto-recovery.

Detects when WSL is in a bad state and attempts automatic recovery.
"""

from __future__ import annotations

import logging
import subprocess
import time

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
        result = subprocess.run(
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
        shutdown_result = subprocess.run(
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
