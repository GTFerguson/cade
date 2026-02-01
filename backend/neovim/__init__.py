"""Neovim integration module for CADE.

Manages Neovim instances with dual-channel communication:
- PTY channel for TUI rendering (terminal output sent to frontend xterm.js)
- RPC channel for structured commands (open file, apply edit, etc.)
"""
