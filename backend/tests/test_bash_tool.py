"""Tests for BashToolExecutor — classification, auto-approve, hard-deny, truncation."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.tools.bash_tool import (
    BashToolExecutor,
    _classify,
    _AUTO_FIRST_TOKENS,
    _HARD_DENY_FIRST_TOKENS,
    _truncate,
)


# ---------------------------------------------------------------------------
# _classify unit tests — no IO, fast
# ---------------------------------------------------------------------------

class TestClassify:
    def test_compound_pipe(self):
        bucket, _ = _classify("ls | grep foo")
        assert bucket == "compound"

    def test_compound_and(self):
        bucket, _ = _classify("cd /tmp && ls")
        assert bucket == "compound"

    def test_compound_semicolon(self):
        bucket, _ = _classify("echo a; echo b")
        assert bucket == "compound"

    def test_compound_subshell(self):
        bucket, _ = _classify("echo $(pwd)")
        assert bucket == "compound"

    def test_compound_backtick(self):
        bucket, _ = _classify("echo `pwd`")
        assert bucket == "compound"

    def test_hard_deny_sudo(self):
        bucket, _ = _classify("sudo rm /etc/passwd")
        assert bucket == "hard_deny"

    def test_hard_deny_reboot(self):
        bucket, _ = _classify("reboot")
        assert bucket == "hard_deny"

    def test_hard_deny_mkfs(self):
        bucket, _ = _classify("mkfs.ext4 /dev/sda1")
        assert bucket == "hard_deny"

    def test_hard_deny_rm_rf(self):
        bucket, _ = _classify("rm -rf /home/user")
        assert bucket == "hard_deny"

    def test_hard_deny_ssh_dir(self):
        bucket, _ = _classify("cat ~/.ssh/id_rsa")
        assert bucket == "hard_deny"

    def test_auto_ls(self):
        bucket, _ = _classify("ls -la /tmp")
        assert bucket == "auto"

    def test_auto_cat(self):
        bucket, _ = _classify("cat README.md")
        assert bucket == "auto"

    def test_auto_grep(self):
        bucket, _ = _classify("grep -r 'def ' src/")
        assert bucket == "auto"

    def test_auto_rg(self):
        bucket, _ = _classify("rg 'import' --glob '*.py'")
        assert bucket == "auto"

    def test_auto_git_status(self):
        bucket, _ = _classify("git status")
        assert bucket == "auto"

    def test_auto_git_log(self):
        bucket, _ = _classify("git log --oneline -10")
        assert bucket == "auto"

    def test_auto_git_diff(self):
        bucket, _ = _classify("git diff HEAD~1")
        assert bucket == "auto"

    def test_prompt_git_commit(self):
        bucket, _ = _classify("git commit -m 'wip'")
        assert bucket == "prompt"

    def test_prompt_git_push(self):
        bucket, _ = _classify("git push origin main")
        assert bucket == "prompt"

    def test_prompt_pytest(self):
        bucket, _ = _classify("pytest backend/tests/")
        assert bucket == "prompt"

    def test_prompt_npm_install(self):
        bucket, _ = _classify("npm install express")
        assert bucket == "prompt"

    def test_prompt_python_script(self):
        bucket, _ = _classify("python3 script.py")
        assert bucket == "prompt"

    def test_prompt_python_dash_c(self):
        bucket, _ = _classify("python3 -c 'print(1)'")
        assert bucket == "prompt"

    def test_auto_python_version(self):
        bucket, _ = _classify("python3 --version")
        assert bucket == "auto"

    def test_auto_python_version_short(self):
        bucket, _ = _classify("python3 -V")
        assert bucket == "auto"

    def test_sed_without_inplace(self):
        # sed without -i is read-only print → auto
        bucket, _ = _classify("sed 's/foo/bar/' file.txt")
        assert bucket == "auto"

    def test_sed_with_inplace(self):
        bucket, _ = _classify("sed -i 's/foo/bar/' file.txt")
        assert bucket == "prompt"

    def test_empty_command_is_hard_deny(self):
        bucket, _ = _classify("")
        assert bucket == "hard_deny"

    def test_path_prefix_stripped(self):
        # /usr/bin/ls should resolve to first token 'ls'
        bucket, _ = _classify("/usr/bin/ls -la")
        assert bucket == "auto"


# ---------------------------------------------------------------------------
# _truncate
# ---------------------------------------------------------------------------

class TestTruncate:
    def test_short_string_unchanged(self):
        assert _truncate("hello", 100) == "hello"

    def test_long_string_truncated(self):
        result = _truncate("x" * 200, 100)
        assert len(result.encode()) > 100  # includes truncation message
        assert "truncated" in result
        assert result.startswith("x" * 100)


# ---------------------------------------------------------------------------
# BashToolExecutor integration tests (mock subprocess)
# ---------------------------------------------------------------------------

@pytest.fixture
def executor(temp_dir: Path) -> BashToolExecutor:
    return BashToolExecutor(temp_dir, connection_id="test-conn")


class TestBashExecution:
    async def test_auto_approved_runs_without_prompt(self, executor):
        out = await executor.execute_async("bash", {"command": "echo hello"})
        assert "hello" in out
        assert "exit: 0" in out

    async def test_stdout_captured(self, executor):
        out = await executor.execute_async("bash", {"command": "echo hello_out"})
        assert "hello_out" in out
        assert "stdout" in out

    async def test_exit_code_captured(self, executor):
        # grep with no match exits 1
        out = await executor.execute_async("bash", {"command": "grep ZZZNOMATCH /dev/null"})
        assert "exit: 1" in out

    async def test_compound_command_rejected(self, executor):
        out = await executor.execute_async("bash", {"command": "ls && pwd"})
        assert "compound" in out.lower()
        assert "Error" in out

    async def test_hard_deny_rejected(self, executor):
        out = await executor.execute_async("bash", {"command": "sudo ls"})
        assert "Error" in out
        assert "refused" in out.lower() or "never permitted" in out.lower() or "hard_deny" in out.lower() or "dangerous" in out.lower()

    async def test_rm_rf_hard_denied(self, executor):
        out = await executor.execute_async("bash", {"command": "rm -rf /tmp/testdir"})
        assert "Error" in out

    async def test_empty_command_rejected(self, executor):
        out = await executor.execute_async("bash", {"command": ""})
        assert "Error" in out

    async def test_cwd_used(self, executor, temp_dir):
        (temp_dir / "sub").mkdir()
        (temp_dir / "sub" / "marker.txt").write_text("here")
        out = await executor.execute_async("bash", {
            "command": "ls",
            "cwd": "sub",
        })
        assert "marker.txt" in out

    async def test_timeout_respected(self, executor):
        # Use python3 -c with a short sleep — python3 is in prompt bucket so mock perms
        mock_perms = MagicMock()
        mock_perms.get_mode.return_value = "code"
        mock_perms.is_command_approved.return_value = True  # pre-approve so no prompt
        with patch("backend.permissions.manager.get_permission_manager", return_value=mock_perms):
            out = await executor.execute_async("bash", {
                "command": "sleep 2",
                "timeout_ms": 200,
            })
        assert "timed out" in out.lower()


class TestBashPermission:
    async def test_prompt_command_blocked_when_permission_denied(self, executor, temp_dir):
        mock_perms = MagicMock()
        mock_perms.get_mode.return_value = "code"
        mock_perms.is_command_approved.return_value = False
        mock_perms.request_permission = AsyncMock(return_value={
            "decision": "deny",
            "message": "User denied",
        })

        with patch("backend.permissions.manager.get_permission_manager", return_value=mock_perms):
            out = await executor.execute_async("bash", {"command": "pytest backend/"})

        assert "Error" in out
        assert "denied" in out.lower()

    async def test_session_approved_command_skips_prompt(self, executor, temp_dir):
        mock_perms = MagicMock()
        mock_perms.get_mode.return_value = "code"
        mock_perms.is_command_approved.return_value = True  # already approved
        mock_perms.request_permission = AsyncMock()

        with patch("backend.permissions.manager.get_permission_manager", return_value=mock_perms):
            out = await executor.execute_async("bash", {"command": "pytest --version"})

        mock_perms.request_permission.assert_not_called()
        assert "exit:" in out

    async def test_prompt_command_runs_when_approved(self, executor):
        mock_perms = MagicMock()
        mock_perms.get_mode.return_value = "code"
        mock_perms.is_command_approved.return_value = False
        mock_perms.request_permission = AsyncMock(return_value={"decision": "allow"})

        with patch("backend.permissions.manager.get_permission_manager", return_value=mock_perms):
            out = await executor.execute_async("bash", {"command": "echo approved"})

        assert "approved" in out
        assert "exit: 0" in out


class TestBashPermissionManager:
    """Test that PermissionManager correctly stores approved commands."""

    def test_approve_command_stored(self):
        from backend.permissions.manager import PermissionManager
        pm = PermissionManager()
        pm.set_mode("code", "conn1")
        assert not pm.is_command_approved("pytest", "conn1")
        pm.approve_command("pytest", "conn1")
        assert pm.is_command_approved("pytest", "conn1")

    def test_approved_command_isolated_per_connection(self):
        from backend.permissions.manager import PermissionManager
        pm = PermissionManager()
        pm.approve_command("pytest", "conn1")
        assert not pm.is_command_approved("pytest", "conn2")

    async def test_approve_with_session_flag_caches_command(self):
        from backend.permissions.manager import PermissionManager
        import asyncio

        pm = PermissionManager()
        pm.set_mode("code", "conn1")

        # Simulate a pending request with _session_key
        fut = asyncio.get_event_loop().create_future()
        from backend.permissions.manager import PermissionRequest
        req = PermissionRequest(
            id="req1",
            tool_name="bash",
            description="pytest backend/",
            tool_input={"command": "pytest backend/", "_session_key": "pytest"},
            connection_id="conn1",
            result=fut,
        )
        pm._pending["req1"] = req

        await pm.approve("req1", approve_for_session=True)

        assert pm.is_command_approved("pytest", "conn1")
        assert fut.result()["decision"] == "allow"
