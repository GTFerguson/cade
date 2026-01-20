"""Tests for the hook command builders."""

from __future__ import annotations

import pytest

from backend.hooks.commands import (
    build_hook_config,
    build_view_file_command,
    _build_all_files_command,
    _build_plan_files_command,
    _get_gateway_ip_command,
)
from backend.hooks.config import CADEHookOptions


class TestBuildViewFileCommand:
    """Tests for build_view_file_command."""

    def test_plan_files_only_filters_correctly(self) -> None:
        """Default command filters for plans/*.md."""
        options = CADEHookOptions(port=3001, all_files=False)
        command = build_view_file_command(options)

        assert "plans/" in command
        assert ".md" in command
        assert "api/view" in command

    def test_all_files_no_filter(self) -> None:
        """--all-files command has no path filter."""
        options = CADEHookOptions(port=3001, all_files=True)
        command = build_view_file_command(options)

        assert "plans/" not in command
        assert "api/view" in command

    def test_custom_port(self) -> None:
        """Custom port is included in curl command."""
        options = CADEHookOptions(port=8080, all_files=False)
        command = build_view_file_command(options)

        assert ":8080/" in command

    def test_default_port(self) -> None:
        """Default port (3001) is used."""
        options = CADEHookOptions()
        command = build_view_file_command(options)

        assert ":3001/" in command


class TestGatewayIpCommand:
    """Tests for gateway IP extraction command."""

    def test_gateway_ip_method(self) -> None:
        """Gateway method uses ip route command."""
        cmd = _get_gateway_ip_command()

        assert "ip route" in cmd
        assert "awk" in cmd


class TestBuildPlanFilesCommand:
    """Tests for plan files command builder."""

    def test_contains_required_elements(self) -> None:
        """Command contains all required elements."""
        command = _build_plan_files_command(3001)

        # Should parse JSON from stdin
        assert "json.load(sys.stdin)" in command
        # Should filter for plans/
        assert "plans/" in command
        # Should filter for .md
        assert ".md" in command
        # Should use xargs with -r (no-run-if-empty)
        assert "xargs -r" in command
        # Should POST to api/view
        assert "curl" in command
        assert "POST" in command
        assert "api/view" in command

    def test_port_included(self) -> None:
        """Port is included in the command."""
        command = _build_plan_files_command(9999)
        assert ":9999/" in command

    def test_fallback_port_included(self) -> None:
        """Fallback port is included for robustness."""
        # When primary is 3001, fallback should be 3000
        command = _build_plan_files_command(3001)
        assert ":3001/" in command
        assert ":3000/" in command
        # Uses || for fallback logic
        assert "||" in command

    def test_fallback_port_swapped(self) -> None:
        """Fallback port is swapped when primary is 3000."""
        command = _build_plan_files_command(3000)
        assert ":3000/" in command
        assert ":3001/" in command


class TestBuildAllFilesCommand:
    """Tests for all files command builder."""

    def test_no_path_filter(self) -> None:
        """All files command doesn't filter paths."""
        command = _build_all_files_command(3001)

        # Should parse JSON and print path directly
        assert "json.load(sys.stdin)" in command
        # Should NOT have plans/ filter
        assert "plans/" not in command
        # Should still POST to api/view
        assert "api/view" in command

    def test_port_included(self) -> None:
        """Port is included in the command."""
        command = _build_all_files_command(7777)
        assert ":7777/" in command

    def test_fallback_port_included(self) -> None:
        """Fallback port is included for robustness."""
        command = _build_all_files_command(3001)
        assert ":3001/" in command
        assert ":3000/" in command
        assert "||" in command


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

    def test_uses_options(self) -> None:
        """Hook config respects options."""
        options = CADEHookOptions(port=5000, all_files=True)
        config = build_hook_config(options)

        command = config["hooks"][0]["command"]
        assert ":5000/" in command
        # all_files means no plans/ filter
        assert "plans/" not in command
