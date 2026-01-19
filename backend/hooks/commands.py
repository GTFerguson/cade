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

    Args:
        port: The CADE server port.

    Returns:
        Shell command string.
    """
    host = _get_gateway_ip_command()
    return (
        f"python3 -c \"import sys,json; p=json.load(sys.stdin)['tool_input']['file_path']; "
        f"print(p) if 'plans/' in p and p.endswith('.md') else None\" 2>/dev/null "
        f"| xargs -r -I {{}} curl -s -X POST -H 'Content-Type: application/json' "
        f"-d '{{\"path\":\"{{}}\"}}' http://{host}:{port}/api/view > /dev/null"
    )


def _build_all_files_command(port: int) -> str:
    """Build command that triggers for all file edits.

    Args:
        port: The CADE server port.

    Returns:
        Shell command string.
    """
    host = _get_gateway_ip_command()
    return (
        f"python3 -c \"import sys,json; print(json.load(sys.stdin)['tool_input']['file_path'])\" "
        f"| xargs -I {{}} curl -s -X POST -H 'Content-Type: application/json' "
        f"-d '{{\"path\":\"{{}}\"}}' http://{host}:{port}/api/view > /dev/null"
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
