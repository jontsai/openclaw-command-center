// ============================================================================
// Authentication Module
// ============================================================================

// Auth header names
const AUTH_HEADERS = {
  tailscale: {
    login: "tailscale-user-login",
    name: "tailscale-user-name",
    pic: "tailscale-user-profile-pic",
  },
  cloudflare: {
    email: "cf-access-authenticated-user-email",
  },
};

function checkAuth(req, authConfig) {
  const mode = authConfig.mode;
  const remoteAddr = req.socket?.remoteAddress || "";
  const isLocalhost =
    remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
  if (isLocalhost) {
    return { authorized: true, user: { type: "localhost", login: "localhost" } };
  }
  if (mode === "none") {
    return { authorized: true, user: null };
  }
  if (mode === "token") {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token && token === authConfig.token) {
      return { authorized: true, user: { type: "token" } };
    }
    return { authorized: false, reason: "Invalid or missing token" };
  }
  if (mode === "tailscale") {
    const login = (req.headers[AUTH_HEADERS.tailscale.login] || "").toLowerCase();
    const name = req.headers[AUTH_HEADERS.tailscale.name] || "";
    const pic = req.headers[AUTH_HEADERS.tailscale.pic] || "";
    if (!login) {
      return { authorized: false, reason: "Not accessed via Tailscale Serve" };
    }
    const isAllowed = authConfig.allowedUsers.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed === login) return true;
      if (allowed.startsWith("*@")) {
        const domain = allowed.slice(2);
        return login.endsWith("@" + domain);
      }
      return false;
    });
    if (isAllowed) {
      return { authorized: true, user: { type: "tailscale", login, name, pic } };
    }
    return { authorized: false, reason: `User ${login} not in allowlist`, user: { login } };
  }
  if (mode === "cloudflare") {
    const email = (req.headers[AUTH_HEADERS.cloudflare.email] || "").toLowerCase();
    if (!email) {
      return { authorized: false, reason: "Not accessed via Cloudflare Access" };
    }
    const isAllowed = authConfig.allowedUsers.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed === email) return true;
      if (allowed.startsWith("*@")) {
        const domain = allowed.slice(2);
        return email.endsWith("@" + domain);
      }
      return false;
    });
    if (isAllowed) {
      return { authorized: true, user: { type: "cloudflare", email } };
    }
    return { authorized: false, reason: `User ${email} not in allowlist`, user: { email } };
  }
  if (mode === "allowlist") {
    const clientIP =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
    const isAllowed = authConfig.allowedIPs.some((allowed) => {
      if (allowed === clientIP) return true;
      if (allowed.endsWith("/24")) {
        const prefix = allowed.slice(0, -3).split(".").slice(0, 3).join(".");
        return clientIP.startsWith(prefix + ".");
      }
      return false;
    });
    if (isAllowed) {
      return { authorized: true, user: { type: "ip", ip: clientIP } };
    }
    return { authorized: false, reason: `IP ${clientIP} not in allowlist` };
  }
  return { authorized: false, reason: "Unknown auth mode" };
}

function getUnauthorizedPage(reason, user, authConfig) {
  const userInfo = user
    ? `<p class="user-info">Detected: ${user.login || user.email || user.ip || "unknown"}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
    <title>Access Denied - Command Center</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e8e8e8;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.1);
            max-width: 500px;
        }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 1.8rem; margin-bottom: 1rem; color: #ff6b6b; }
        .reason { color: #aaa; margin-bottom: 1.5rem; font-size: 0.95rem; }
        .user-info { color: #ffeb3b; margin: 1rem 0; font-size: 0.9rem; }
        .instructions { color: #ccc; font-size: 0.85rem; line-height: 1.5; }
        .auth-mode { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); color: #888; font-size: 0.75rem; }
        code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🔐</div>
        <h1>Access Denied</h1>
        <div class="reason">${reason}</div>
        ${userInfo}
        <div class="instructions">
            <p>This dashboard requires authentication via <strong>${authConfig.mode}</strong>.</p>
            ${authConfig.mode === "tailscale" ? '<p style="margin-top:1rem">Make sure you\'re accessing via your Tailscale URL and your account is in the allowlist.</p>' : ""}
            ${authConfig.mode === "cloudflare" ? '<p style="margin-top:1rem">Make sure you\'re accessing via Cloudflare Access and your email is in the allowlist.</p>' : ""}
        </div>
        <div class="auth-mode">Auth mode: <code>${authConfig.mode}</code></div>
    </div>
</body>
</html>`;
}

module.exports = { AUTH_HEADERS, checkAuth, getUnauthorizedPage };
