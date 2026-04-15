---
created: 2026-01-31
status: in-progress
tags:
- deployment
- remote
- ec2
- cloud
- architecture
title: Remote Deployment
updated: 2026-02-02
---

# Remote Deployment

Run CADE backend on a remote server (EC2, VPS, etc.) and connect from any device via browser.

## Motivation

**Current setup:**
- CADE backend runs locally on your machine
- Frontend connects to `localhost:3000`
- Only accessible from the machine running CADE

**Remote deployment:**
- Backend runs on EC2 (or any server)
- Frontend connects from anywhere via URL
- Access from laptop, desktop, tablet, phone
- Persistent session (server keeps running)
- Team collaboration (multiple users, same instance)

## Architecture Advantage

**CADE is already architected for remote deployment:**

✅ **Web-based frontend** - Already runs in browser (not Electron)
✅ **WebSocket communication** - Frontend ↔ Backend already uses network protocol
✅ **Session state** - Already managed and persisted
✅ **PTY management** - Backend already handles terminal spawning
✅ **No localhost coupling** - Protocol doesn't assume local connection

**This means:** The core remote deployment model already works. The work is adding production-ready security and deployment tooling.

## Use Cases

### 1. Access from Anywhere

```
Developer's workflow:
- Morning: Work on laptop at coffee shop
- Afternoon: Continue on desktop at office
- Evening: Check progress on phone
- Same CADE session, same context, no setup
```

### 2. Persistent Sessions

```
Start long-running build/test on EC2
Close laptop, go to meeting
Session keeps running on server
Reconnect later, build is done
```

### 3. Team Collaboration

```
Team lead starts CADE session on shared EC2
Team members connect to same instance
See each other's terminal output
Pair programming, code reviews
Shared development environment
```

### 4. Powerful Backend

```
Local laptop: 8GB RAM, no GPU
EC2 instance: 32GB RAM, GPU for AI workloads
Run expensive builds, tests, AI inference on server
Frontend stays lightweight (just browser)
```

### 5. Consistent Environment

```
"Works on my machine" → eliminated
Entire team uses same EC2 environment
Dependencies, tools, config all consistent
New team member: just open URL, start working
```

## Architecture

### Deployment Model

```
┌─────────────────────────────────────────────┐
│                  Internet                    │
└─────────────────┬───────────────────────────┘
                  │ HTTPS (port 443)
                  ▼
┌─────────────────────────────────────────────┐
│           Nginx Reverse Proxy                │
│   - SSL termination                          │
│   - WebSocket upgrade                        │
│   - Static file serving (frontend)           │
└─────────────────┬───────────────────────────┘
                  │ HTTP/WS (localhost:3000)
                  ▼
┌─────────────────────────────────────────────┐
│          CADE Backend (Python)               │
│   - WebSocket server                         │
│   - PTY management                           │
│   - File system access                       │
│   - Session management                       │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│        Project Files & Sessions              │
│   - /home/user/projects/                     │
│   - .cade/session.json                       │
└─────────────────────────────────────────────┘
```

### Network Flow

**User connects:**
1. Browser → `https://cade.example.com`
2. Nginx serves frontend static files
3. Frontend opens WebSocket: `wss://cade.example.com/ws`
4. Nginx upgrades connection, proxies to backend
5. Backend authenticates user (if auth enabled)
6. Backend restores session or creates new one
7. Terminal I/O flows over WebSocket

## What Needs to Be Added

### 1. Security Layer (Critical)

**Authentication:**
- Login system (username/password, OAuth, API keys)
- Session tokens for WebSocket connections
- Multi-user session isolation

**HTTPS/WSS:**
- SSL certificate (Let's Encrypt)
- Enforce HTTPS (redirect HTTP → HTTPS)
- Secure WebSocket (WS → WSS)

**Authorization:**
- Project-level access control (who can access which projects)
- Read-only vs read-write permissions
- Admin vs developer roles

**File system security:**
- Restrict backend to specific directories (no arbitrary file access)
- Validate file paths (prevent directory traversal)
- Optional: chroot/container isolation

### 2. Deployment Configuration

**Systemd service:**
```ini
[Unit]
Description=CADE Backend
After=network.target

[Service]
Type=simple
User=cade
WorkingDirectory=/opt/cade
ExecStart=/opt/cade/venv/bin/python backend/main.py
Restart=always

[Install]
WantedBy=multi-user.target
```

**Nginx config:**
```nginx
server {
    listen 443 ssl http2;
    server_name cade.example.com;

    ssl_certificate /etc/letsencrypt/live/cade.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cade.example.com/privkey.pem;

    # Serve frontend static files
    location / {
        root /opt/cade/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # API endpoints
    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

**Docker option:**
```dockerfile
FROM python:3.11-slim

# Install Neovim, git, build tools
RUN apt-get update && apt-get install -y \
    neovim git build-essential curl

# Install CADE
COPY . /opt/cade
WORKDIR /opt/cade
RUN pip install -r requirements.txt

EXPOSE 3000
CMD ["python", "backend/main.py"]
```

### 3. Multi-User Support

**Session isolation:**
- Each user has their own sessions (`.cade/sessions/<user_id>/`)
- File tree scoped to user's projects
- No cross-user session access

**Resource limits:**
- Max terminals per user
- Max agents per user
- CPU/memory limits (container-level or systemd)

**User management:**
- User creation/deletion
- Password reset
- API key management

### 4. Configuration

**Environment variables:**
```bash
# Production mode
CADE_ENV=production

# Base URL
CADE_BASE_URL=https://cade.example.com

# Authentication
CADE_AUTH_ENABLED=true
CADE_SESSION_SECRET=<random-secret>

# CORS
CADE_CORS_ORIGINS=https://cade.example.com

# File system
CADE_PROJECTS_ROOT=/home/cade/projects
```

**Config file (`.cade/config.toml`):**
```toml
[server]
host = "0.0.0.0"
port = 3000
base_url = "https://cade.example.com"

[auth]
enabled = true
session_timeout = 3600  # 1 hour

[security]
projects_root = "/home/cade/projects"
restrict_fs_access = true

[limits]
max_terminals_per_user = 10
max_agents_per_user = 5
```

## Deployment Options

### Option 1: EC2 Instance

**Pros:**
- Full control over environment
- Can install any tools
- Flexible instance sizing

**Cons:**
- Manual security updates
- Need to manage systemd, nginx
- More operational overhead

**Recommended for:** Teams with devops experience, need for customization

### Option 2: Docker Container

**Pros:**
- Consistent environment
- Easy to deploy/redeploy
- Can use Docker Compose for multi-service setup
- Works on any Docker host (EC2, DigitalOcean, etc.)

**Cons:**
- Container overhead
- Need to configure volumes for persistence

**Recommended for:** Quick deployment, consistency across environments

### Option 3: Kubernetes

**Pros:**
- Auto-scaling
- High availability
- Load balancing for multiple CADE instances

**Cons:**
- Complex setup
- Overkill for small teams

**Recommended for:** Large teams, enterprise deployments

## Implementation Plan

### Phase 1: Basic Remote Support ✅

**Goal:** Get CADE running on EC2, accessible via browser

- [x] Backend binds to `0.0.0.0` (`CADE_HOST` env var)
- [x] Environment variables for all config (`CADE_PORT`, `CADE_HOST`, `CADE_ROOT_PATH`, etc.)
- [x] CORS configuration (`CADE_CORS_ORIGINS`, middleware in `backend/middleware.py`)
- [x] Deploy to EC2, test connection

### Phase 2: HTTPS & WSS — Partial

**Goal:** Secure communication

- [x] Reverse proxy base path support (`CADE_ROOT_PATH`)
- [x] Nginx config documented (see Architecture section above)
- [ ] Domain name setup
- [ ] Let's Encrypt SSL certificate
- [ ] Live Nginx deployment

> [!IMPORTANT]
> TLS on nginx is the proper solution for encrypted remote connections. SSH tunnels from the desktop app have a known compatibility issue: the Tauri WebView (WebView2 on Windows) produces "Invalid HTTP request" errors on the backend when connecting through an SSH tunnel, despite identical `curl` requests working correctly. Root cause is undiagnosed — likely related to how the WebView formats HTTP upgrade requests through the tunnel. Adding TLS to nginx (`wss://` end-to-end) would eliminate the need for SSH tunnels entirely and provide encryption for both browser and desktop connections.

### Phase 3: Authentication ✅

**Goal:** Secure single-user access

- [x] Login page (backend-served HTML, `backend/login_page.py`)
- [x] Token-based auth with HMAC-SHA256 session cookies
- [x] WebSocket auth via query param (`?token=`), rejects 1008 on failure
- [x] Frontend token management (`frontend/src/auth/tokenManager.ts`)
- [x] Per-profile auth tokens forwarded from desktop remote profiles

### Desktop SSH Tunnel Path ✅

**Goal:** Connect to remote backends from the Tauri desktop app

- [x] SSH tunnel management (`ssh_tunnel.rs`, `tunnel_registry.rs`)
- [x] Remote profile CRUD (modal, editor, Tauri file storage)
- [x] Connection testing from profile manager
- [x] Shift+click and Ctrl-A+C keybinding triggers
- [x] HTTP→WebSocket URL transformation with `/ws` path
- [x] Per-profile auth token forwarding to WebSocket
- [x] TERM environment variable for remote PTY sessions

### Phase 4: Production Hardening

**Goal:** Production-ready

- [ ] Resource limits (systemd or Docker)
- [ ] File system restrictions
- [ ] Logging and monitoring
- [ ] Backup strategy (user data, sessions)
- [ ] Health checks and auto-restart

### Phase 5: Team Features

**Goal:** Collaboration

- [ ] Multi-user session isolation
- [ ] User management UI
- [ ] Project sharing (multiple users, same project)
- [ ] Role-based access (admin, developer, read-only)
- [ ] Audit logs (who did what)

## Security Considerations

### Critical

**1. Authentication is required**
- Never expose unauthenticated CADE to internet
- Use strong session secrets
- Implement rate limiting on login

**2. File system isolation**
- Backend must NOT have arbitrary file access
- Validate all file paths
- Restrict to project directories only

**3. HTTPS/WSS required**
- Never use unencrypted WebSocket over internet
- SSL certificate must be valid (no self-signed in production)

**4. Input validation**
- Terminal input, file paths, all user input must be validated
- Prevent command injection, path traversal

### Medium Priority

**5. Resource limits**
- Prevent runaway processes
- Limit terminals, agents, file uploads

**6. Network isolation**
- Firewall: Only allow 443 (HTTPS) and 22 (SSH for admin)
- Backend should only be accessible via reverse proxy

**7. Logging**
- Log authentication attempts
- Log file access
- Audit trail for multi-user environments

## Open Questions

1. **Multi-tenancy:** Should one CADE instance support multiple isolated teams/orgs, or one instance per team?

2. **Shared sessions:** Should multiple users be able to connect to the same session (pair programming), or always isolated?

3. **Billing/quotas:** If offering as a service, how to track usage and enforce limits?

4. **Backup strategy:** How to backup user sessions, projects, agent memory? Auto-backup to S3?

5. **Updates:** How to update CADE backend without disrupting active sessions? Rolling update, blue/green deployment?

6. ~~**Mobile optimization:**~~ ✅ Resolved — mobile interface is fully implemented with touch toolbar, file explorer, and slideout viewer. Remote deployment + mobile access works seamlessly.

## See Also

- [[../user/mobile-guide|Mobile Guide]] - Mobile interface for remote access from phones and tablets
- [[agent-orchestration|Agent Orchestration]] - Multi-agent works well with persistent remote sessions
- [[../technical/core/frontend-architecture|Frontend Architecture]]
- [[../technical/core/backend-architecture|Backend Architecture]] (if exists)
