# Remote Deployment Workflow

Rules for working with CADE deployed on remote servers (EC2, VPS, etc.).

## Backend Code Changes

**CRITICAL**: After making any changes to backend code, you MUST:
1. **Copy/sync the updated code to the remote server** (git pull, scp, rsync, etc.)
2. **Then restart the backend** to pick up the changes

Restarting alone does nothing if the code hasn't been synced!

### Complete Workflow

**Step 1: Sync code to remote**

Choose one method:

```bash
# Option A: Using scp for a single file
scp backend/websocket.py clann-vm:~/cade-test/backend/websocket.py

# Option B: Using rsync for multiple files
rsync -av backend/ clann-vm:~/cade-test/backend/

# Option C: Using git (if changes are committed)
ssh clann-vm "cd ~/cade-test && git pull"
```

**Step 2: Restart backend**

```bash
ssh clann-vm << 'EOF'
cd ~/cade-test
if [ -f cade.pid ]; then
    kill $(cat cade.pid) 2>/dev/null || true
    rm cade.pid
fi
source venv/bin/activate
TOKEN=$(cat .token)
export CADE_AUTH_ENABLED=true
export CADE_AUTH_TOKEN="$TOKEN"
export CADE_HOST=0.0.0.0
export CADE_PORT=3000
export CADE_AUTO_START_CLAUDE=false
export CADE_AUTO_OPEN_BROWSER=false
export CADE_SHELL_COMMAND=bash
export PYTHONPATH=/home/gary/cade-test:$PYTHONPATH
nohup python3 -m backend.main serve --no-browser > cade.log 2>&1 &
echo $! > cade.pid
echo "Backend restarted with PID: $(cat cade.pid)"
EOF
```

### When to Restart

Restart the backend after changes to:
- `backend/**/*.py` - Any Python backend code
- `backend/requirements.txt` - Dependencies (also need to re-run `pip install`)
- Environment variables - Config changes

### Frontend Changes

Frontend changes (TypeScript, CSS) do NOT require backend restart:
- Changes to `frontend/**/*` are picked up by the dev server or require frontend rebuild
- Desktop app changes require app rebuild, not backend restart

## Testing Workflow

1. Make code changes locally
2. **SYNC CODE TO REMOTE** (scp, rsync, or git pull) - DO NOT SKIP THIS!
3. **Restart backend** (use restart command above)
4. Verify code was synced: `ssh clann-vm "grep -n 'some_unique_string' ~/cade-test/backend/file.py"`
5. Refresh browser to test changes
6. Check logs: `ssh clann-vm "tail -50 ~/cade-test/cade.log"`

## Common Mistakes

- ❌ **Restarting backend without syncing code first** (most common mistake!)
- ❌ Forgetting to restart backend after syncing code
- ❌ Only restarting frontend dev server
- ❌ Not verifying code was actually synced to remote
- ❌ Not checking logs after restart
- ✅ Always sync code THEN restart backend
- ✅ Verify the specific changes are present on remote before restarting
- ✅ Check logs to confirm successful restart

## Remote Servers

Current remote deployments:
- **clann-vm**: AWS EC2 (52.30.205.70) - Training server with GPU
  - Working dir: `~/cade-test`
  - Uses auth token in `.token` file
  - Shell: `bash`
  - Auto-start Claude: `false` (Claude not installed)
