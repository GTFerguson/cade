---
title: Remote Connections
created: 2026-02-01
updated: 2026-02-01
status: active
tags: [user, remote, ssh, deployment]
---

# Remote Connections

Connect to CADE backends running on remote servers (EC2, VPS, ML training machines) from the desktop app or browser.

## Opening a Remote Tab

**Keyboard:** Press `Ctrl-a` then `Shift+C`
**Mouse:** `Shift+click` the `+` tab button

This opens the Remote Connection Modal where you can select or create a profile.

## Remote Connection Modal

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `j` / `k` or `Arrow keys` | Navigate profile list |
| `Enter` | Connect to selected profile |
| `n` | New profile |
| `e` | Edit selected profile |
| `d` | Delete selected profile |
| `Esc` | Close modal |

## Connection Types

### Direct Connection

Connects directly to a remote backend URL. Works in both the desktop app and browser.

**When to use:** Backend is directly accessible (same network, port forwarded, or behind a reverse proxy).

### SSH Tunnel (Desktop Only)

Creates an SSH tunnel to forward a local port to the remote backend. Only available in the Tauri desktop app.

**When to use:** Backend is behind a firewall, only accessible via SSH. This is the most common setup for personal development servers.

**Requirements:**
- SSH keys configured in `~/.ssh/config`
- Passwordless authentication (SSH keys, not passwords)
- Desktop app (tunnels are not available in the browser)

**How it works:**
1. CADE spawns `ssh -L localPort:localhost:remotePort sshHost -N`
2. Multiple tabs reuse the same tunnel
3. Tunnel stops automatically when the last tab using it closes
4. All tunnels stop when the app quits

## Creating a Profile

### Direct Connection

1. Open the Remote Connection Modal (`Ctrl-a` + `Shift+C`)
2. Press `n` for New Profile
3. Fill in:
   - **Name**: A label for this connection (e.g., "ML Server")
   - **Connection Type**: Direct Connection
   - **URL**: The backend URL (e.g., `http://52.30.205.70:3000`)
   - **Auth Token**: The backend's auth token (if auth is enabled)
   - **Default Path**: Project directory on the remote server
4. Click **Test Connection** to verify
5. Click **Save**

### SSH Tunnel

1. Open the Remote Connection Modal (`Ctrl-a` + `Shift+C`)
2. Press `n` for New Profile
3. Fill in:
   - **Name**: A label (e.g., "clann-vm")
   - **Connection Type**: SSH Tunnel
   - **SSH Host**: Hostname from `~/.ssh/config` (e.g., "clann-vm")
   - **Local Port**: Port to forward locally (e.g., 3000)
   - **Remote Port**: Backend port on the remote server (e.g., 3000)
   - **URL**: Auto-fills to `http://localhost:<localPort>`
   - **Auth Token**: The remote backend's auth token
   - **Default Path**: Project directory on the remote server
4. Click **Test Connection** to verify
5. Click **Save**

## Remote Tab Indicators

Remote tabs display icons to show connection type:

| Icon | Meaning |
|------|---------|
| Globe | Direct connection |
| Lock | SSH tunnel connection (hover for tunnel PID) |

## Profile Storage

| Platform | Location |
|----------|----------|
| Desktop (Windows) | `%USERPROFILE%\.cade\remote-profiles.json` |
| Desktop (Linux/macOS) | `~/.cade/remote-profiles.json` |
| Browser | `localStorage` (key: `cade_remote_profiles`) |

> [!NOTE]
> Desktop and browser storage are separate. Each maintains its own profile list.

Profiles can be edited manually:

```bash
cat ~/.cade/remote-profiles.json
```

### Profile Format

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "unique-id",
      "name": "My Server",
      "url": "http://localhost:3000",
      "connectionType": "ssh-tunnel",
      "sshHost": "my-server",
      "localPort": 3000,
      "remotePort": 3000,
      "authToken": "your-token-here",
      "defaultPath": "/home/user/projects"
    }
  ]
}
```

## Setting Up a Remote Backend

### On the Remote Server

```bash
# Clone CADE
git clone <repo> ~/cade && cd ~/cade

# Install dependencies
pip install -r requirements.txt

# Generate an auth token
python -c "import secrets; print(secrets.token_hex(32))" > .token

# Start the backend
export CADE_AUTH_ENABLED=true
export CADE_AUTH_TOKEN="$(cat .token)"
export CADE_HOST=0.0.0.0
export CADE_PORT=3000
export CADE_SHELL_COMMAND=bash
python -m backend.main serve --no-browser
```

### Auth Token

When `CADE_AUTH_ENABLED=true`, the backend requires a token for all connections. Copy the token from the server's `.token` file into your remote profile's **Auth Token** field.

## Platform Differences

| Feature | Desktop (Tauri) | Browser |
|---------|----------------|---------|
| Direct connections | Yes | Yes |
| SSH tunnels | Yes | No |
| Profile storage | Config file | localStorage |
| Tunnel auto-management | Yes | N/A |

## See Also

- [[keybindings|Keyboard Navigation]] — Full keybinding reference
- [[../future/remote-deployment|Remote Deployment Roadmap]] — Future plans
