# CADE Desktop - Verification Checklist

Use this checklist to verify the desktop application works correctly before release.

## Pre-Build Verification

### Prerequisites Installed

- [ ] Node.js 16+ installed: `node --version`
- [ ] npm installed: `npm --version`
- [ ] Rust/Cargo installed: `cargo --version`
- [ ] Python 3.11+ installed: `python3 --version`
- [ ] PyInstaller installed: `python3 -c "import PyInstaller"`
- [ ] Platform-specific tools (see QUICKSTART.md)

### Source Code Ready

- [ ] Frontend builds: `cd frontend && npm run build`
- [ ] Backend tests pass: `cd backend && pytest` (if tests exist)
- [ ] No uncommitted changes (or changes are intentional)

## Build Verification

### Backend Bundling (PyInstaller)

Run: `python3 -m PyInstaller scripts/pyinstaller.spec --clean`

- [ ] Build completes without errors
- [ ] Executable created: `dist/cade-backend` or `dist/cade-backend.exe`
- [ ] Executable size reasonable (<100 MB)
- [ ] Can run standalone: `./dist/cade-backend serve --port 3000`
- [ ] Frontend accessible: Open `http://127.0.0.1:3000` in browser
- [ ] Static files served correctly
- [ ] No missing module errors in logs

### Desktop App Build

Run: `cd desktop && npm run build`

- [ ] Rust compilation succeeds
- [ ] Frontend bundled correctly
- [ ] Backend copied to resources
- [ ] Installers generated in `target/release/bundle/`
- [ ] Installer file size reasonable (<15 MB)

### Platform-Specific Builds

#### Windows
- [ ] MSI installer created
- [ ] NSIS installer created
- [ ] Both installers can be run
- [ ] No antivirus false positives

#### macOS
- [ ] DMG created
- [ ] DMG can be mounted
- [ ] App can be dragged to Applications

#### Linux
- [ ] DEB package created
- [ ] AppImage created
- [ ] DEB installs: `sudo dpkg -i *.deb`
- [ ] AppImage is executable

## Installation Verification

### Clean Install

- [ ] Installer runs without errors
- [ ] App appears in Applications/Start Menu
- [ ] Desktop/dock icon correct (or placeholder)
- [ ] Uninstaller works (if applicable)

### First Launch

- [ ] App window opens within 5 seconds
- [ ] Window size is 1400x900 (or remembered size)
- [ ] No error dialogs on launch
- [ ] Backend starts automatically
- [ ] Console shows no errors

## Functional Verification

### Terminal Connection

- [ ] Terminal displays in app
- [ ] Backend connects via WebSocket
- [ ] Claude Code prompt appears (or shell prompt)
- [ ] Can type in terminal
- [ ] Terminal output displays correctly
- [ ] ANSI colors render correctly

### File Operations

#### File Tree
- [ ] File tree loads on left sidebar
- [ ] Directories can be expanded/collapsed
- [ ] Files can be clicked
- [ ] File icons show correct types
- [ ] Large repos load within 5 seconds

#### File Viewing
- [ ] Click file → content displays
- [ ] Syntax highlighting works
- [ ] Markdown renders correctly
- [ ] Large files (>1MB) load without freezing
- [ ] Binary files show appropriate message

#### File Editing
- [ ] Can edit files in markdown viewer (if supported)
- [ ] Save writes to disk correctly
- [ ] File watcher updates UI on external changes

#### File Creation
- [ ] Can create new files (via Claude or UI)
- [ ] New files appear in tree
- [ ] Content persists after app restart

### Claude Code Integration

- [ ] Claude Code runs inside terminal
- [ ] Can send messages to Claude
- [ ] Claude responses appear in terminal
- [ ] File operations work (claude reading files)
- [ ] Code execution works
- [ ] Plan files viewed when created (if hook configured)

### Multiple Instances

- [ ] Can launch second instance
- [ ] Both instances work independently
- [ ] Different ports allocated automatically
- [ ] No port conflicts

### Session Persistence

- [ ] Close app
- [ ] Reopen app in same project
- [ ] Session state restored (scrollback visible)
- [ ] Working directory correct

### Performance

- [ ] App launches in <5 seconds
- [ ] Memory usage <150 MB after startup
- [ ] No memory leaks (check after 30 min use)
- [ ] Terminal input responsive (<50ms latency)
- [ ] File tree loads quickly (<5s for 1000 files)

## Platform-Specific Verification

### Windows/WSL

- [ ] WSL detected correctly
- [ ] Claude Code runs in WSL
- [ ] PTY spawns without errors
- [ ] File paths translate WSL ↔ Windows correctly
- [ ] UNC paths work (`\\wsl$\...`)
- [ ] No "Windows Security" warnings on launch

### macOS

- [ ] App runs on macOS 11+
- [ ] Native PTY works
- [ ] No Gatekeeper warnings (after signing)
- [ ] Keyboard shortcuts work (Cmd+Q, etc.)
- [ ] Touch Bar shows correctly (if applicable)

### Linux

- [ ] Runs on Ubuntu 20.04+, Debian 11+
- [ ] Native PTY works
- [ ] File dialogs work
- [ ] System tray icon appears (if implemented)
- [ ] No X11/Wayland compatibility issues

## Shutdown Verification

### Normal Shutdown

- [ ] Close window → app exits
- [ ] Backend process stops cleanly
- [ ] No orphan processes left: `ps aux | grep cade`
- [ ] No "not responding" errors

### Force Quit

- [ ] Force quit app (Task Manager/Activity Monitor)
- [ ] Backend process terminates within 5 seconds
- [ ] Session state still saved

## Error Handling

### Backend Fails to Start

- [ ] Meaningful error message shown
- [ ] Logs indicate failure reason
- [ ] App doesn't hang indefinitely

### WebSocket Disconnect

- [ ] Reconnection attempted automatically
- [ ] User notified of disconnection
- [ ] Session restores on reconnect

### Port Already in Use

- [ ] App finds different port automatically
- [ ] No manual intervention needed
- [ ] Error logged if all ports exhausted

### Missing Dependencies

- [ ] Clear error if WSL not found (Windows)
- [ ] Clear error if Claude not installed
- [ ] Instructions shown to user

## Security Verification

### File Access

- [ ] App only accesses project directory
- [ ] No unauthorized file system access
- [ ] Respects .gitignore patterns

### Network

- [ ] Only binds to 127.0.0.1 (localhost)
- [ ] No external network connections (except Claude API)
- [ ] No telemetry without consent

### Code Signing (if implemented)

- [ ] Windows: Signed with valid certificate
- [ ] macOS: Signed and notarized
- [ ] Linux: N/A

## Documentation Verification

- [ ] README.md is accurate
- [ ] QUICKSTART.md installation steps work
- [ ] All commands in docs execute correctly
- [ ] Troubleshooting section helpful
- [ ] Links not broken

## Regression Testing

### Existing Features (from Web Version)

- [ ] All web features work in desktop
- [ ] No regressions in terminal behavior
- [ ] File operations identical to web
- [ ] Performance comparable or better

### Edge Cases

- [ ] Very large files (>10 MB)
- [ ] Very deep directory trees (>10 levels)
- [ ] Special characters in filenames
- [ ] Symbolic links handled correctly
- [ ] Network drives (Windows) or mounts work

## Release Checklist

### Pre-Release

- [ ] All verification steps pass
- [ ] Version numbers updated (`Cargo.toml`, `package.json`, `tauri.conf.json`)
- [ ] CHANGELOG.md updated
- [ ] Git tag created: `git tag v0.1.0`

### Release Assets

- [ ] Windows MSI uploaded
- [ ] Windows NSIS installer uploaded
- [ ] macOS DMG uploaded (signed)
- [ ] Linux DEB uploaded
- [ ] Linux AppImage uploaded
- [ ] SHA256 checksums provided
- [ ] Release notes written

### Post-Release

- [ ] Installation tested from release assets
- [ ] Auto-update tested (if configured)
- [ ] Download links work
- [ ] GitHub release published

## Known Issues

Document any known issues here:

- [ ] Icons are placeholders (need proper branding)
- [ ] Code signing not configured (macOS will show Gatekeeper warning)
- [ ] Auto-update not fully configured yet
- [ ] (Add others as discovered)

## Testing Sign-Off

| Platform | Tester | Date | Status | Notes |
|----------|--------|------|--------|-------|
| Windows 11 + WSL2 | | | ⬜ Pass / ❌ Fail | |
| Windows 10 + WSL2 | | | ⬜ Pass / ❌ Fail | |
| macOS 14 (arm64) | | | ⬜ Pass / ❌ Fail | |
| macOS 13 (x64) | | | ⬜ Pass / ❌ Fail | |
| Ubuntu 22.04 | | | ⬜ Pass / ❌ Fail | |
| Ubuntu 20.04 | | | ⬜ Pass / ❌ Fail | |
| Debian 12 | | | ⬜ Pass / ❌ Fail | |

## Notes

Use this space for additional observations during testing:

```
[Add testing notes here]
```
