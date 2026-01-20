"""Command builders for CADE hooks."""

from __future__ import annotations

from backend.hooks.config import CADEHookOptions


def build_view_file_command(options: CADEHookOptions) -> str:
    """Build the shell command for the view file hook.

    Creates a command that:
    1. Reads JSON from stdin (Claude Code passes tool input this way)
    2. Extracts the file_path from the tool input
    3. Optionally filters for plan files only
    4. POSTs to the CADE API endpoint

    Args:
        options: Hook configuration options.

    Returns:
        The complete shell command string.
    """
    if options.all_files:
        return _build_all_files_command(options.port)
    return _build_plan_files_command(options.port)


def _get_gateway_ip_command() -> str:
    """Get the shell command to extract gateway IP for WSL connectivity."""
    return "$(ip route show default | awk '{print $3}')"


def _build_plan_files_command(port: int) -> str:
    """Build command that only triggers for plan files (plans/*.md).

    The command tries multiple ports for robustness:
    - First tries the specified port
    - Falls back to alternative port (3000 if primary is 3001, or vice versa)

    This allows the hook to work with either dev (3001) or stable (3000) server.

    Args:
        port: The primary CADE server port.

    Returns:
        Shell command string.
    """
    host = _get_gateway_ip_command()
    fallback_port = 3000 if port == 3001 else 3001
    return (
        f"python3 -c \"import sys,json; p=json.load(sys.stdin)['tool_input']['file_path']; "
        f"print(p) if 'plans/' in p and p.endswith('.md') else None\" 2>/dev/null "
        f"| xargs -r -I {{}} sh -c '"
        f"HOST={host}; "
        f'curl -sf -X POST -H "Content-Type: application/json" -d "{{\\\"path\\\":\\\"{{}}\\\"}}" '
        f"http://$HOST:{port}/api/view || "
        f'curl -sf -X POST -H "Content-Type: application/json" -d "{{\\\"path\\\":\\\"{{}}\\\"}}" '
        f"http://$HOST:{fallback_port}/api/view"
        f"' > /dev/null 2>&1"
    )


def _build_all_files_command(port: int) -> str:
    """Build command that triggers for all file edits.

    The command tries multiple ports for robustness (same as plan files command).

    Args:
        port: The primary CADE server port.

    Returns:
        Shell command string.
    """
    host = _get_gateway_ip_command()
    fallback_port = 3000 if port == 3001 else 3001
    return (
        f"python3 -c \"import sys,json; print(json.load(sys.stdin)['tool_input']['file_path'])\" "
        f"| xargs -I {{}} sh -c '"
        f"HOST={host}; "
        f'curl -sf -X POST -H "Content-Type: application/json" -d "{{\\\"path\\\":\\\"{{}}\\\"}}" '
        f"http://$HOST:{port}/api/view || "
        f'curl -sf -X POST -H "Content-Type: application/json" -d "{{\\\"path\\\":\\\"{{}}\\\"}}" '
        f"http://$HOST:{fallback_port}/api/view"
        f"' > /dev/null 2>&1"
    )


def build_hook_config(options: CADEHookOptions) -> dict:
    """Build the complete hook configuration dict.

    Args:
        options: Hook configuration options.

    Returns:
        Dict suitable for adding to settings.json hooks.
    """
    return {
        "matcher": "Edit|Write",
        "hooks": [
            {
                "type": "command",
                "command": build_view_file_command(options),
            }
        ],
    }
