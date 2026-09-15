"""Tests for Claude Code account profiles."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend import claude_profiles
from backend.claude_profiles import (
    claude_dir_for,
    default_claude_dir,
    is_plan_file,
    load_profiles,
    profile_dirs,
    profile_for,
    terminal_env,
)


@pytest.fixture
def profiles_file(temp_dir: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the loader at a claude.toml inside the test's temp dir."""
    path = temp_dir / "claude.toml"
    monkeypatch.setattr(claude_profiles, "_profiles_file", lambda: path)
    return path


@pytest.fixture
def work_profile(temp_dir: Path, profiles_file: Path) -> dict[str, Path]:
    work_dir = temp_dir / "claude-work"
    work_root = temp_dir / "projects" / "client"
    profiles_file.write_text(
        f"""
[[profile]]
name = "work"
config-dir = "{work_dir}"
paths = ["{work_root}"]
"""
    )
    return {"config_dir": work_dir, "root": work_root}


class TestLoadProfiles:
    def test_missing_file_means_no_profiles(self, profiles_file: Path) -> None:
        assert load_profiles() == []

    def test_no_config_directory_means_no_profiles(self, monkeypatch) -> None:
        monkeypatch.setattr(claude_profiles, "_profiles_file", lambda: None)
        assert load_profiles() == []

    def test_parses_profile(self, work_profile: dict[str, Path]) -> None:
        [profile] = load_profiles()
        assert profile.name == "work"
        assert profile.config_dir == work_profile["config_dir"]
        assert profile.paths == (work_profile["root"],)

    def test_expands_home(self, profiles_file: Path) -> None:
        profiles_file.write_text(
            '[[profile]]\nconfig-dir = "~/.claude-work"\npaths = ["~/work"]\n'
        )
        [profile] = load_profiles()
        assert profile.config_dir == Path.home() / ".claude-work"
        assert profile.paths == (Path.home() / "work",)

    def test_unnamed_profile_gets_positional_name(self, profiles_file: Path) -> None:
        profiles_file.write_text('[[profile]]\nconfig-dir = "/c"\npaths = ["/p"]\n')
        assert load_profiles()[0].name == "profile-1"

    def test_invalid_toml_is_ignored_not_raised(self, profiles_file: Path) -> None:
        profiles_file.write_text("[[profile]\nnot toml")
        assert load_profiles() == []

    @pytest.mark.parametrize(
        "body",
        [
            'paths = ["/p"]',  # no config-dir
            'config-dir = "/c"',  # no paths
            'config-dir = "/c"\npaths = "/p"',  # paths not a list
            'config-dir = ""\npaths = ["/p"]',  # empty config-dir
            'config-dir = "/c"\npaths = [1]',  # non-string path
        ],
    )
    def test_malformed_entry_is_skipped(self, profiles_file: Path, body: str) -> None:
        profiles_file.write_text(
            f'[[profile]]\n{body}\n\n[[profile]]\nname = "ok"\nconfig-dir = "/c2"\npaths = ["/p2"]\n'
        )
        assert [p.name for p in load_profiles()] == ["ok"]

    def test_profile_key_not_an_array_is_ignored(self, profiles_file: Path) -> None:
        profiles_file.write_text('profile = "work"\n')
        assert load_profiles() == []


class TestProfileFor:
    def test_project_at_root_matches(self, work_profile: dict[str, Path]) -> None:
        assert profile_for(work_profile["root"]).name == "work"

    def test_nested_project_matches(self, work_profile: dict[str, Path]) -> None:
        assert profile_for(work_profile["root"] / "repos" / "api").name == "work"

    def test_accepts_string_path(self, work_profile: dict[str, Path]) -> None:
        assert profile_for(str(work_profile["root"])).name == "work"

    def test_sibling_sharing_a_name_prefix_does_not_match(
        self, work_profile: dict[str, Path]
    ) -> None:
        sibling = work_profile["root"].with_name(work_profile["root"].name + "-other")
        assert profile_for(sibling) is None

    def test_unrelated_project_has_no_profile(
        self, work_profile: dict[str, Path], temp_dir: Path
    ) -> None:
        assert profile_for(temp_dir / "personal") is None

    def test_most_specific_path_wins(self, profiles_file: Path, temp_dir: Path) -> None:
        profiles_file.write_text(
            f"""
[[profile]]
name = "broad"
config-dir = "/broad"
paths = ["{temp_dir / 'work'}"]

[[profile]]
name = "narrow"
config-dir = "/narrow"
paths = ["{temp_dir / 'work' / 'client'}"]
"""
        )
        assert profile_for(temp_dir / "work" / "client" / "repo").name == "narrow"
        assert profile_for(temp_dir / "work" / "internal").name == "broad"


class TestDirectories:
    def test_default_dir_is_home_claude(self, monkeypatch) -> None:
        monkeypatch.setattr("backend.claude_profiles.sys.platform", "linux")
        assert default_claude_dir() == Path.home() / ".claude"

    def test_default_dir_honours_claude_config_dir(self, monkeypatch) -> None:
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", "/custom/claude")
        assert default_claude_dir() == Path("/custom/claude")

    def test_claude_dir_for_profile_project(self, work_profile: dict[str, Path]) -> None:
        assert claude_dir_for(work_profile["root"]) == work_profile["config_dir"]

    def test_claude_dir_for_other_project_is_default(
        self, work_profile: dict[str, Path], temp_dir: Path, monkeypatch
    ) -> None:
        monkeypatch.setattr("backend.claude_profiles.sys.platform", "linux")
        assert claude_dir_for(temp_dir / "personal") == Path.home() / ".claude"

    def test_profile_dirs_are_deduplicated(self, profiles_file: Path) -> None:
        profiles_file.write_text(
            '[[profile]]\nconfig-dir = "/w"\npaths = ["/a"]\n\n'
            '[[profile]]\nconfig-dir = "/w"\npaths = ["/b"]\n\n'
            '[[profile]]\nconfig-dir = "/x"\npaths = ["/c"]\n'
        )
        assert profile_dirs() == [Path("/w"), Path("/x")]


class TestTerminalEnv:
    def test_sets_config_dir_for_profile_project(
        self, work_profile: dict[str, Path]
    ) -> None:
        assert terminal_env(work_profile["root"] / "repo") == {
            "CLAUDE_CONFIG_DIR": str(work_profile["config_dir"])
        }

    def test_empty_for_other_projects(
        self, work_profile: dict[str, Path], temp_dir: Path
    ) -> None:
        assert terminal_env(temp_dir / "personal") == {}


class TestIsPlanFile:
    def test_default_plans_dir(self, profiles_file: Path) -> None:
        assert is_plan_file(Path.home() / ".claude" / "plans" / "jazzy-moon.md")

    def test_wsl_unc_default_plans_dir(self, profiles_file: Path) -> None:
        assert is_plan_file(r"\\wsl$\Ubuntu\home\u\.claude\plans\jazzy-moon.md")

    def test_profile_plans_dir(self, work_profile: dict[str, Path]) -> None:
        assert is_plan_file(work_profile["config_dir"] / "plans" / "jazzy-moon.md")

    def test_project_docs_plans_are_not_claude_plans(
        self, work_profile: dict[str, Path]
    ) -> None:
        assert not is_plan_file(work_profile["root"] / "docs" / "plans" / "roadmap.md")

    def test_file_nested_below_profile_plans_dir_is_not_a_plan(
        self, work_profile: dict[str, Path]
    ) -> None:
        assert not is_plan_file(work_profile["config_dir"] / "plans" / "sub" / "x.md")
