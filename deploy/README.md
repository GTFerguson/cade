# CADE Remote Deployment Guide

This guide covers deploying CADE backend to a remote server (EC2, VPS, etc.) and connecting to it from the desktop app.

## Overview

CADE supports two deployment modes:

1. **Local Mode** (default): Desktop app starts local Python backend automatically
2. **Remote Mode**: Desktop app connects to a backend running on EC2 or another server

## Prerequisites

- Remote server (EC2, VPS, or any Linux machine)
- SSH access to the server
- Python 3.10+ installed on the server
- CADE desktop app installed locally

## Phase 1: Deploy Backend to Remote Server

### 1. Setup EC2/VPS Instance

**Recommended specs:**
- Instance type: `t2.micro` or equivalent (1 vCPU, 1GB RAM minimum)
- OS: Ubuntu 22.04 LTS
- Storage: 8GB minimum

**Security groups:**
```
Port 22 (SSH): Your IP only
Port 3000 (CADE): Your IP only (or 0.0.0.0/0 with strong token)
```

### 2. Install CADE on Server

SSH into your server:

```bash
ssh ubuntu@EC2_IP
```

Install Python and dependencies:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python 3.10+
sudo apt install python3 python3-pip python3-venv -y

# Clone CADE repository (or copy files)
git clone https://github.com/your-username/cade.git
cd cade

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
```

### 3. Generate Authentication Token

Generate a secure random token:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**Save this token - you'll need it for the desktop app.**

Example output:
```
a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789
```

### 4. Configure Backend

Create environment file:

```bash
cat > .env << EOF
CADE_AUTH_ENABLED=true
CADE_AUTH_TOKEN=YOUR_TOKEN_HERE
CADE_HOST=0.0.0.0
CADE_PORT=3000
CADE_CORS_ORIGINS=
CADE_SHELL_COMMAND=bash
CADE_WORKING_DIR=/home/ubuntu
CADE_AUTO_START_CLAUDE=false
CADE_AUTO_OPEN_BROWSER=false
EOF
```

Replace `YOUR_TOKEN_HERE` with the token generated in step 3.

**Important settings for remote deployment:**
- `CADE_AUTO_START_CLAUDE=false` - Disables auto-start of Claude Code on shell startup. Set this to `false` for remote deployments where Claude might not be installed. If Claude is installed on the remote server, you can set this to `true`.
- `CADE_AUTO_OPEN_BROWSER=false` - Prevents browser from opening on the server (no display).

### 5. Start Backend

Start the backend:

```bash
source venv/bin/activate
export $(cat .env | xargs)
python backend/main.py serve --no-browser
```

**Test it's working:**

```bash
# From another terminal on the server
curl http://localhost:3000
```

You should see a response from the backend.

### 6. Run Backend as Service (Optional)

To keep the backend running after logout, use systemd:

```bash
sudo cat > /etc/systemd/system/cade.service << EOF
[Unit]
Description=CADE Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/cade
Environment="PATH=/home/ubuntu/cade/venv/bin"
EnvironmentFile=/home/ubuntu/cade/.env
ExecStart=/home/ubuntu/cade/venv/bin/python backend/main.py serve --no-browser
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cade
sudo systemctl start cade
```

Check status:

```bash
sudo systemctl status cade
```

## Phase 2: Connect Desktop App to Remote Backend

### 1. Configure Remote Backend in Desktop App

**Option A: Using Settings UI (if implemented)**

1. Open CADE desktop app
2. Go to Settings → Remote Backend
3. Enable "Remote Backend"
4. Enter backend URL: `http://EC2_IP:3000`
5. Enter the auth token from Phase 1, Step 3
6. Click "Test Connection" to verify
7. Click "Save"
8. Restart the app

**Option B: Manual Configuration**

Create config file at:
- Windows: `%APPDATA%\cade\config.json`
- macOS: `~/Library/Application Support/cade/config.json`
- Linux: `~/.config/cade/config.json`

```json
{
  "remote_backend": {
    "enabled": true,
    "url": "http://EC2_IP:3000",
    "token": "YOUR_TOKEN_HERE"
  }
}
```

Also store the token in localStorage (open DevTools in the app):

```javascript
localStorage.setItem("cade_auth_token", "YOUR_TOKEN_HERE");
```

### 2. Restart Desktop App

Close and reopen the CADE desktop app. It should now connect to the remote backend instead of starting a local one.

### 3. Verify Connection

Check that:
- ✓ Terminal shows EC2 file system (not local)
- ✓ File tree shows EC2 directories
- ✓ Can edit files on EC2
- ✓ Terminal commands run on EC2

## Switching Back to Local Mode

### Option 1: Via Settings UI

1. Go to Settings → Remote Backend
2. Uncheck "Enable Remote Backend"
3. Click "Save"
4. Restart the app

### Option 2: Manual

1. Edit `config.json` and set `enabled: false`
2. Restart the app

The app will start the local Python backend automatically.

## Security Best Practices

### 1. Use Strong Tokens

```bash
# Generate a cryptographically secure token
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 2. Restrict IP Access

**EC2 Security Groups:**
- Port 3000: Only your IP address (not 0.0.0.0/0)
- Update your IP if it changes

**Firewall (ufw):**
```bash
sudo ufw allow from YOUR_IP to any port 3000
sudo ufw enable
```

### 3. Use HTTPS/WSS (Optional - Phase 2)

For production deployments, use nginx + Let's Encrypt:

```bash
# Install nginx and certbot
sudo apt install nginx certbot python3-certbot-nginx -y

# Configure domain
# Point your domain (e.g., cade.example.com) to EC2 IP

# Get SSL certificate
sudo certbot --nginx -d cade.example.com

# Configure nginx reverse proxy
sudo cat > /etc/nginx/sites-available/cade << 'EOF'
server {
    listen 80;
    server_name cade.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name cade.example.com;

    ssl_certificate /etc/letsencrypt/live/cade.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cade.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/cade /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Update desktop app to use HTTPS URL: `https://cade.example.com`

## Troubleshooting

### Connection Failed

**Check backend is running:**
```bash
ssh ubuntu@EC2_IP
sudo systemctl status cade
curl http://localhost:3000
```

**Check security groups:**
- Port 3000 must allow your IP
- Use EC2 console to verify

**Check token:**
- Token in desktop app must match token on server
- No extra spaces or characters

### Authentication Failed

**Error: "WebSocket connection rejected: invalid or missing auth token"**

Solution:
- Verify token matches between app and server
- Check token is saved in localStorage
- Try regenerating token on server and updating app

### Terminal Shows Local Files Instead of EC2

**Problem:** Desktop app is still using local backend

Solution:
- Verify `config.json` has `enabled: true`
- Check desktop app console for errors
- Restart the app completely

### Files Not Accessible

**Error: Permission denied**

Solution:
```bash
# On server, check file permissions
ls -la /path/to/file

# Fix permissions if needed
chmod 644 /path/to/file
```

## Performance Tips

### 1. Use Same Region as You

Choose an EC2 region close to your location for lower latency.

### 2. Keep Desktop App Open

The WebSocket connection stays alive as long as the app is open. No reconnection overhead.

### 3. Monitor Resource Usage

```bash
# Check CPU/memory usage
htop

# Check disk usage
df -h
```

## Cost Estimation

**AWS EC2 t2.micro (1 vCPU, 1GB RAM):**
- On-demand: ~$8-10/month
- Reserved instance (1 year): ~$5-6/month
- Free tier: Free for first 12 months

**Bandwidth:**
- Terminal traffic: <1GB/month typical
- Included in EC2 pricing

## Next Steps

- **Phase 2 (Optional):** Setup HTTPS/WSS with nginx and Let's Encrypt for secure connections
- **Multi-user:** Current implementation is single-user only
- **Docker:** Consider containerizing the backend for easier deployment

## Support

For issues or questions:
- Check logs: `sudo journalctl -u cade -f`
- Backend logs on server: Check systemd logs or manual output
- Desktop app: Check console (DevTools) for errors
