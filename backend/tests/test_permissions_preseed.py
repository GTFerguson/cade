"""Verify that scratch paths like /tmp are pre-approved per connection."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

from backend.permissions.manager import ConnectionState, _default_approved_paths


class TestDefaultApprovedPaths:
    def test_tmp_is_preseeded(self):
        paths = _default_approved_paths()
        assert "/tmp" in paths

    def test_tmpdir_env_var_is_honored(self):
        with patch.dict(os.environ, {"TMPDIR": "/custom/tmp/"}):
            paths = _default_approved_paths()
        assert "/custom/tmp" in paths
        assert "/tmp" in paths

    def test_connection_state_inherits_preseed(self):
        state = ConnectionState()
        assert "/tmp" in state.approved_paths

    def test_connection_states_are_independent(self):
        s1 = ConnectionState()
        s2 = ConnectionState()
        s1.approved_paths.add("/home/user/scratch")
        assert "/home/user/scratch" not in s2.approved_paths


class TestPathApprovalMatching:
    def test_tmp_subpath_is_approved(self):
        from backend.permissions.manager import PermissionManager
        pm = PermissionManager()
        # Trigger state creation for a fresh connection
        pm.set_mode("code", "conn1")
        assert pm.is_path_approved(Path("/tmp/scratch.txt"), "conn1")
        assert pm.is_path_approved(Path("/tmp/sub/dir/x.json"), "conn1")

    def test_non_tmp_path_is_not_approved(self):
        from backend.permissions.manager import PermissionManager
        pm = PermissionManager()
        pm.set_mode("code", "conn1")
        assert not pm.is_path_approved(Path("/etc/passwd"), "conn1")
        assert not pm.is_path_approved(Path("/home/user/secret.txt"), "conn1")
