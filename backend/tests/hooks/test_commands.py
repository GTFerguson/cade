"""Tests for the hook command/script builders."""

from __future__ import annotations

import pytest

from backend.hooks.commands import (
    HOOK_SCRIPT_TEMPLATE,
    build_hook_command,
    build_hook_config,
    generate_hook_script,
)
from backend.hooks.config import CADEHookOptions


class TestGenerateHookScript:
    """Tests for generate_hook_script()."""

    def test_plans_only_mode(self) -> None:
        """Default options produce plans_only filter mode."""
        options = CADEHookOptions(all_files=False)
        script = generate_hook_script(options)

        assert 'FILTER_MODE = "plans_only"' in script

    def test_all_files_mode(self) -> None:
        """--all-files produces all_files filter mode."""
        options = CADEHookOptions(all_files=True)
        script = generate_hook_script(options)

        assert 'FILTER_MODE = "all_files"' in script

    def test_script_is_valid_python(self) -> None:
        """Generated script compiles as valid Python."""
        options = CADEHookOptions()
        script = generate_hook_script(options)

        # compile() raises SyntaxError if invalid
        compile(script, "view_file.py", "exec")

    def test_all_files_script_is_valid_python(self) -> None:
        """All-files variant also compiles as valid Python."""
        options = CADEHookOptions(all_files=True)
        script = generate_hook_script(options)

        compile(script, "view_file.py", "exec")

    def test_script_has_shebang(self) -> None:
        """Script starts with Python shebang."""
        script = generate_hook_script(CADEHookOptions())
        assert script.startswith("#!/usr/bin/env python3")

    def test_script_reads_stdin(self) -> None:
        """Script reads JSON from stdin."""
        script = generate_hook_script(CADEHookOptions())
        assert "json.load(sys.stdin)" in script

    def test_script_posts_to_api_view(self) -> None:
        """Script POSTs to /api/view endpoint."""
        script = generate_hook_script(CADEHookOptions())
        assert "/api/view" in script

    def test_script_uses_urllib(self) -> None:
        """Script uses urllib (no curl dependency)."""
        script = generate_hook_script(CADEHookOptions())
        assert "urllib.request" in script
        assert "curl" not in script

    def test_script_always_exits_zero(self) -> None:
        """Script always exits 0 to never block Claude Code."""
        script = generate_hook_script(CADEHookOptions())
        assert "sys.exit(0)" in script

    def test_script_logs_to_file(self) -> None:
        """Script logs to ~/.cade/hook.log."""
        script = generate_hook_script(CADEHookOptions())
        assert "hook.log" in script

    def test_script_reads_port_file(self) -> None:
        """Script reads port from ~/.cade/port."""
        script = generate_hook_script(CADEHookOptions())
        assert '"port"' in script or "'port'" in script

    def test_script_reads_host_file(self) -> None:
        """Script reads host from ~/.cade/host."""
        script = generate_hook_script(CADEHookOptions())
        assert '"host"' in script or "'host'" in script

    def test_script_detects_wsl(self) -> None:
        """Script detects WSL via /proc/version."""
        script = generate_hook_script(CADEHookOptions())
        assert "/proc/version" in script
        assert "microsoft" in script

    def test_script_extracts_session_id(self) -> None:
        """Script extracts session_id from hook data."""
        script = generate_hook_script(CADEHookOptions())
        assert "session_id" in script

    def test_script_extracts_cwd(self) -> None:
        """Script extracts cwd from hook data."""
        script = generate_hook_script(CADEHookOptions())
        assert '"cwd"' in script


class TestBuildHookCommand:
    """Tests for build_hook_command()."""

    def test_invokes_python3(self) -> None:
        """Command uses python3 to run the script."""
        cmd = build_hook_command()
        assert cmd.startswith("python3 ")

    def test_points_to_script(self) -> None:
        """Command points to the hook script in ~/.cade/hooks/."""
        cmd = build_hook_command()
        assert "~/.cade/hooks/view_file.py" in cmd


class TestBuildHookConfig:
    """Tests for hook config builder."""

    def test_structure(self) -> None:
        """Hook config has correct structure."""
        options = CADEHookOptions(port=3001)
        config = build_hook_config(options)

        assert "matcher" in config
        assert config["matcher"] == "Edit|Write"
        assert "hooks" in config
        assert len(config["hooks"]) == 1
        assert config["hooks"][0]["type"] == "command"
        assert "command" in config["hooks"][0]

    def test_command_is_script_based(self) -> None:
        """Hook config uses the script-based command."""
        options = CADEHookOptions()
        config = build_hook_config(options)

        command = config["hooks"][0]["command"]
        assert "view_file.py" in command
        assert "curl" not in command


class TestHookScriptTemplate:
    """Tests for the raw template constant."""

    def test_template_has_placeholder(self) -> None:
        """Template contains the filter_mode placeholder."""
        assert "{filter_mode}" in HOOK_SCRIPT_TEMPLATE

    def test_template_no_unresolved_placeholders_after_render(self) -> None:
        """After rendering, the filter_mode placeholder is replaced."""
        rendered = HOOK_SCRIPT_TEMPLATE.replace("{filter_mode}", "plans_only")
        assert "{filter_mode}" not in rendered
        compile(rendered, "view_file.py", "exec")
