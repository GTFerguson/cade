"""What the chat agent's composed prompt tells it about CADE.

The prompt is the only place the model learns what it runs in, so a claim
there that the code does not back becomes something the agent tells the user.
"""

from __future__ import annotations

import pytest

from backend.prompts.compose import MODE_MODULES, compose_prompt

MODES = sorted(MODE_MODULES)


@pytest.mark.parametrize("mode", MODES)
def test_names_the_tools_that_put_things_in_front_of_the_user(mode):
    prompt = compose_prompt(mode)
    assert "view_file" in prompt
    assert "show_html" in prompt


@pytest.mark.parametrize("mode", MODES)
def test_does_not_promise_that_written_docs_open_by_themselves(mode):
    # Only the Claude Code terminal has a hook that opens edited plan docs.
    # A chat agent's file tools do not, so it must open them itself.
    assert "auto-opens" not in compose_prompt(mode)


def test_expands_the_name_as_the_rest_of_the_project_does():
    prompt = compose_prompt("code")
    assert "Claude Agentic Development Environment" in prompt
    assert "Context-Aware Development Environment" not in prompt


@pytest.mark.parametrize("mode", MODES)
def test_says_each_thing_once(mode):
    # Every mode loads the dashboard, editor and nkrdn modules, so the base
    # module repeating them only costs context.
    prompt = compose_prompt(mode)
    assert prompt.count("automatically open or reload the affected file") == 1
    assert prompt.count("nkrdn indexes code structure") == 1
