# Remote Deployment Workflow

Rules for working with CADE deployed on remote servers (EC2, VPS, etc.).

## One-Command Deploy

The primary deployment method uses the automated deploy script:

```bash
./scripts/deploy.sh clann-vm
```

This builds the frontend locally, syncs files via rsync, and runs the remote
setup script to configure nginx, systemd, auth, and dependencies.

Common options:

```bash
# Skip frontend rebuild (just sync backend changes + restart)
./scripts/deploy.sh clann-vm --skip-build

# Skip full setup (just sync + restart systemd service)
./scripts/deploy.sh clann-vm --skip-build --skip-setup
```

## Backend Code Changes

**CRITICAL**: After making any changes to backend code, you MUST:
1. **Copy/sync the updated code to the remote server**
2. **Then restart the backend** to pick up the changes

Restarting alone does nothing if the code hasn't been synced!

### Quick Sync + Restart (without full setup)

```bash
# Option A: Use deploy script with --skip-build --skip-setup
./scripts/deploy.sh clann-vm --skip-build --skip-setup

# Option B: Manual rsync + systemd restart
rsync -az --exclude '__pycache__' backend/ clann-vm:~/cade/backend/
ssh clann-vm "sudo systemctl restart cade"
```

### When to Restart

Restart the backend after changes to:
- `backend/**/*.py` - Any Python backend code
- `requirements.txt` - Dependencies (re-run full deploy or `pip install` manually)
- Environment variables - Config changes (update systemd unit, then restart)

### Frontend Changes

Frontend changes (TypeScript, CSS) do NOT require backend restart:
- Rebuild locally and sync `frontend/dist/`: `./scripts/deploy.sh clann-vm --skip-setup`
- Desktop app changes require app rebuild, not backend restart

## Testing Workflow

1. Make code changes locally
2. Deploy: `./scripts/deploy.sh clann-vm --skip-build` (or full deploy)
3. Verify code was synced: `ssh clann-vm "grep -n 'some_unique_string' ~/cade/backend/file.py"`
4. Refresh browser to test changes
5. Check logs: `ssh clann-vm "journalctl -u cade -n 50 --no-pager"`

## Common Mistakes

- ❌ **Restarting backend without syncing code first** (most common mistake!)
- ❌ Forgetting to restart backend after syncing code
- ❌ Only restarting frontend dev server
- ❌ Not verifying code was actually synced to remote
- ❌ Not checking logs after restart
- ✅ Always sync code THEN restart backend
- ✅ Verify the specific changes are present on remote before restarting
- ✅ Check logs to confirm successful restart

## Service Management

The backend runs as a systemd service (`cade.service`):

```bash
# Status, logs, restart
ssh clann-vm "systemctl status cade"
ssh clann-vm "journalctl -u cade -f"
ssh clann-vm "sudo systemctl restart cade"
```

## Remote Servers

Current remote deployments:
- **clann-vm**: AWS EC2 (52.30.205.70) - Training server with GPU
  - Install dir: `~/cade`
  - URL: `http://52.30.205.70/cade/` (nginx reverse proxy on port 80)
  - Working dir: `/home/gary` (user home)
  - Uses auth token in `~/cade/.token` file
  - Root path: `/cade` (CADE_ROOT_PATH)
  - Shell: `bash`
  - Service: `systemd` (cade.service, auto-restart on failure, auto-start on boot)
