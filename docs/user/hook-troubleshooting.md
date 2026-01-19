---
title: Hook Troubleshooting
created: 2026-01-18
updated: 2026-01-18
status: active
tags: [user, troubleshooting, hooks, wsl, networking]
---

# Hook Troubleshooting

Guide for debugging Claude Code hooks, especially the plan viewer hook on Windows/WSL.

## Quick Checklist

1. ✓ Hook installed in `~/.claude/settings.json`
2. ✓ Claude Code restarted after hook installation
3. ✓ CADE server running
4. ✓ Server listening on `0.0.0.0` (not `localhost`)
5. ✓ WSL can reach Windows host IP
6. ✓ Windows firewall allows port 3001 (if needed)

## Common Issues

### Hook Not Triggering

**Symptom**: Claude edits files but viewer doesn't update.

**Check hook is installed:**

```bash
wsl cat ~/.claude/settings.json
```

Should contain:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"import sys,json; p=json.load(sys.stdin)['tool_input']['file_path']; print(p) if 'plans/' in p and p.endswith('.md') else None\" 2>/dev/null | xargs -r -I {} curl -s -X POST -H 'Content-Type: application/json' -d '{\"path\":\"{}\"}' http://$(ip route show default | awk '{print $3}'):3001/api/view > /dev/null"
          }
        ]
      }
    ]
  }
}
```

**Verify Claude Code restarted:**

Hooks only load on Claude Code startup. After modifying `settings.json`, restart Claude Code.

### WSL Cannot Reach Server

**Symptom**: Hook installed but curl fails silently.

**Test WSL->Windows connectivity:**

```bash
# Get Windows host IP from WSL
wsl ip route show default
# Output: default via 192.168.X.X dev eth0 proto kernel

# Test connection
wsl curl -v http://192.168.X.X:3001/
```

If this fails with "Connection refused":

**Problem 1: Server not listening on all interfaces**

Check server is on `0.0.0.0`:

```powershell
netstat -an | findstr 3001
```

Should show:
```
TCP    0.0.0.0:3001           0.0.0.0:0              LISTENING
```

If it shows `127.0.0.1:3001`, the server is only listening locally.

**Fix**: Server should default to `0.0.0.0` as of commit af5f88e. If running an older version, update or set:

```bash
export CADE_HOST=0.0.0.0
```

**Problem 2: Windows Firewall blocking**

Run PowerShell as Administrator:

```powershell
netsh advfirewall firewall add rule name="CADE" dir=in action=allow protocol=tcp localport=3001
```

Then test again:

```bash
wsl curl -v http://192.168.X.X:3001/
```

### Hook Command Fails

**Test the Python parsing:**

```bash
wsl bash -c 'echo "{\"tool_input\":{\"file_path\":\"/home/user/.claude/plans/test.md\"}}" | python3 -c "import sys,json; p=json.load(sys.stdin)[\"tool_input\"][\"file_path\"]; print(p) if \"plans/\" in p and p.endswith(\".md\") else None"'
```

Should print: `/home/user/.claude/plans/test.md`

If this fails, check:
- `python3` is available in WSL
- JSON parsing works

**Test the full pipeline:**

```bash
wsl bash -c 'echo "{\"tool_input\":{\"file_path\":\"/home/user/.claude/plans/test.md\"}}" | python3 -c "import sys,json; p=json.load(sys.stdin)[\"tool_input\"][\"file_path\"]; print(p) if \"plans/\" in p and p.endswith(\".md\") else None" | xargs -r -I {} curl -v -X POST -H "Content-Type: application/json" -d "{\"path\":\"{}\"}" http://$(ip route show default | awk "{print \$3}"):3001/api/view'
```

Check:
- Path prints correctly
- curl connects successfully
- Server logs show the request

### Wrong IP in Hook

**Symptom**: Hook uses `localhost` instead of gateway IP.

Old hooks used `localhost` which doesn't work from WSL. Reinstall:

```bash
python -m backend.main setup-hook
```

This uses `$(ip route show default | awk '{print $3}')` to get the Windows host IP dynamically.

### Hook Installed in Wrong Location

**Windows vs WSL paths:**

When running `setup-hook` from Windows PowerShell, it writes to the WSL home directory via UNC path:

```
\\wsl$\Ubuntu\home\gary\.claude\settings.json
```

Verify this is correct:

```bash
wsl ls -la ~/.claude/settings.json
```

If the file doesn't exist or is in the wrong location, the hook was written to Windows home instead.

## Debugging Hook Execution

### Enable Claude Code Debug Mode

Claude Code doesn't show hook output by default. To debug:

1. Add debug output to hook:

```bash
"command": "echo \"Hook triggered\" >> /tmp/hook.log && python3 -c ..."
```

2. Check the log:

```bash
wsl tail -f /tmp/hook.log
```

### Check Server Logs

Start server with debug mode:

```bash
python -m backend.main serve --port 3001 --debug
```

When hook triggers, you should see:

```
INFO: API /api/view called with path: /home/gary/.claude/plans/test.md
INFO: Broadcasting to 1 connection(s): type=view-file
```

## WSL Networking Reference

### Finding Windows Host IP

```bash
# Method 1: Default gateway (recommended)
wsl ip route show default | awk '{print $3}'

# Method 2: Nameserver (may not work in all WSL configs)
wsl grep nameserver /etc/resolv.conf | awk '{print $2}'
```

### Testing Connectivity

```bash
# Test HTTP
wsl curl -v http://<WINDOWS_IP>:3001/

# Test WebSocket
wsl curl -v --no-buffer \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  http://<WINDOWS_IP>:3001/ws
```

## Manual Hook Installation

If `setup-hook` doesn't work, edit `~/.claude/settings.json` manually:

1. Open in editor:

```bash
wsl nano ~/.claude/settings.json
```

2. Add hook structure:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"import sys,json; p=json.load(sys.stdin)['tool_input']['file_path']; print(p) if 'plans/' in p and p.endswith('.md') else None\" 2>/dev/null | xargs -r -I {} curl -s -X POST -H 'Content-Type: application/json' -d '{\"path\":\"{}\"}' http://$(ip route show default | awk '{print $3}'):3001/api/view > /dev/null"
          }
        ]
      }
    ]
  }
}
```

3. Validate JSON:

```bash
wsl python3 -m json.tool ~/.claude/settings.json > /dev/null
```

4. Restart Claude Code

## Advanced Debugging

### Capture Full Hook Input

Replace hook command temporarily:

```json
"command": "cat > /tmp/hook-input.json"
```

Then trigger the hook and inspect:

```bash
wsl cat /tmp/hook-input.json | python3 -m json.tool
```

This shows exactly what Claude Code passes to hooks.

### Test API Endpoint Directly

```bash
wsl curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"path":"/home/gary/.claude/plans/test.md"}' \
  http://192.168.X.X:3001/api/view
```

Should return:

```json
{
  "success": true,
  "path": "/home/gary/.claude/plans/test.md",
  "connections": 1
}
```

## See Also

- [[plan-viewer|Plan Viewer Hook]] - Setup and usage
- [[configuration|Configuration Guide]] - Server configuration
