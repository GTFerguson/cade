"""Self-contained login page HTML for CADE remote access."""

import json


def get_login_page_html(root_path: str = "") -> str:
    """Return login page HTML with the base path injected for reverse proxy support."""
    return _LOGIN_PAGE_TEMPLATE.replace("__ROOT_PATH_PLACEHOLDER__", json.dumps(root_path))


_LOGIN_PAGE_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>CADE — Login</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg-primary: #1c1b1a;
    --bg-secondary: #242321;
    --bg-tertiary: #35322d;
    --bg-hover: #45413b;
    --text-primary: #f8f6f2;
    --text-secondary: #d9cec3;
    --text-muted: #857f78;
    --accent-green: #aeee00;
    --accent-red: #ff2c4b;
    --border-color: #45413b;
    --border-focus: #aeee00;
    --font-mono: "JetBrains Mono", "Fira Code", Consolas, monospace;
  }

  html, body {
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--font-mono);
  }

  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .login-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 32px;
    width: 100%;
    max-width: 360px;
  }

  .login-title {
    text-align: center;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 4px;
    margin-bottom: 32px;
    color: var(--text-primary);
  }

  .login-input {
    width: 100%;
    padding: 12px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 16px;
    outline: none;
    transition: border-color 0.2s;
    -webkit-appearance: none;
  }

  .login-input::placeholder { color: var(--text-muted); }
  .login-input:focus { border-color: var(--border-focus); }

  .login-button {
    width: 100%;
    height: 48px;
    margin-top: 16px;
    background: var(--accent-green);
    color: var(--bg-primary);
    border: none;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
    touch-action: manipulation;
  }

  .login-button:hover { opacity: 0.9; }
  .login-button:active { opacity: 0.8; }
  .login-button:disabled { opacity: 0.5; cursor: not-allowed; }

  .login-error {
    margin-top: 12px;
    color: var(--accent-red);
    font-size: 13px;
    text-align: center;
    min-height: 20px;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-6px); }
    40%, 80% { transform: translateX(6px); }
  }

  .login-card.shake { animation: shake 0.4s ease; }
</style>
</head>
<body>
  <div class="login-card" id="card">
    <div class="login-title">CADE</div>
    <form id="login-form" autocomplete="on">
      <input
        class="login-input"
        id="token"
        type="password"
        placeholder="Auth token"
        autocomplete="current-password"
        required
      >
      <button class="login-button" type="submit" id="submit-btn">Sign In</button>
      <div class="login-error" id="error"></div>
    </form>
  </div>

  <script>
    var BASE = __ROOT_PATH_PLACEHOLDER__;
    const form = document.getElementById('login-form');
    const input = document.getElementById('token');
    const error = document.getElementById('error');
    const card = document.getElementById('card');
    const btn = document.getElementById('submit-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      btn.disabled = true;

      try {
        const res = await fetch(BASE + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: input.value }),
        });

        const data = await res.json();

        if (res.ok && data.success) {
          localStorage.setItem('cade_auth_token', input.value);
          window.location.href = BASE + '/';
        } else {
          error.textContent = data.error || 'Invalid token';
          card.classList.remove('shake');
          void card.offsetWidth;
          card.classList.add('shake');
          input.focus();
          input.select();
        }
      } catch (err) {
        error.textContent = 'Connection failed';
      } finally {
        btn.disabled = false;
      }
    });

    input.focus();
  </script>
</body>
</html>
"""
