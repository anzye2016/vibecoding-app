#!/bin/bash
set -e

RELAY_DIR="/opt/vibecoding-relay"
DOMAIN="${1:-your-domain.com}"
NODE_VERSION="20"

echo "============================================"
echo "  VibeCoding - Server Setup"
echo "  Target: $RELAY_DIR"
echo "  Domain: $DOMAIN"
echo "============================================"

# --- Node.js ---
if ! command -v node &>/dev/null; then
    echo "[1/6] Installing Node.js $NODE_VERSION..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt install -y nodejs
else
    echo "[OK] Node.js $(node -v)"
fi

# --- Relay files ---
echo "[2/6] Setting up relay at $RELAY_DIR..."
mkdir -p "$RELAY_DIR"
cd "$(dirname "$0")/../relay"
cp server.js package.json "$RELAY_DIR/"
cd "$RELAY_DIR"
npm install --production

# --- Tokens ---
echo "[3/6] Generating tokens..."
TOKEN_FILE="$RELAY_DIR/tokens.env"
if [ ! -f "$TOKEN_FILE" ]; then
    PC_TOKEN=${PC_TOKEN:-$(openssl rand -hex 16)}
    PHONE_TOKEN=${PHONE_TOKEN:-$(openssl rand -hex 16)}
    cat > "$TOKEN_FILE" <<EOF
PC_TOKEN=$PC_TOKEN
PHONE_TOKEN=$PHONE_TOKEN
EOF
    chmod 600 "$TOKEN_FILE"
    echo "[OK] Tokens generated. Save these:"
    echo "      PC:    $PC_TOKEN"
    echo "      Phone: $PHONE_TOKEN"
else
    echo "[OK] Tokens file exists"
    source "$TOKEN_FILE"
fi

# --- systemd ---
echo "[4/6] Creating systemd service..."
cat > /etc/systemd/system/vibecoding-relay.service <<EOF
[Unit]
Description=VibeCoding Relay Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$RELAY_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=root
EnvironmentFile=$TOKEN_FILE
Environment=ORIGIN=https://$DOMAIN
Environment=HOST=127.0.0.1
Environment=PORT=8766

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vibecoding-relay
systemctl restart vibecoding-relay
echo "[OK] vibecoding-relay service started"

# --- nginx: ensure rate limit zones ---
echo "[5/6] Configuring nginx..."
LIMITS_CONF="/etc/nginx/conf.d/vibecoding-limits.conf"
if [ ! -f "$LIMITS_CONF" ]; then
    cat > "$LIMITS_CONF" <<'EOF'
limit_req_zone $binary_remote_addr zone=vibecoding:10m rate=1r/s;
limit_conn_zone $binary_remote_addr zone=vibecoding_conn:10m;
EOF
    echo "[OK] Created $LIMITS_CONF"
else
    echo "[OK] $LIMITS_CONF already exists"
fi

# --- nginx: inject location block into existing site config or create standalone ---
NGINX_CONF="/etc/nginx/sites-available/vibecoding"
VIBECODING_LOCATION=$(cat <<'LOC'
    location /vibecoding/ws {
        limit_conn vibecoding_conn 5;
        limit_req zone=vibecoding burst=2 nodelay;
        access_log off;

        proxy_pass http://127.0.0.1:8766/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
        proxy_cache off;
    }
LOC
)

EXISTING_SITE=$(find /etc/nginx/sites-enabled -maxdepth 1 -type l -exec grep -l "server_name .*$DOMAIN" {} \; 2>/dev/null | head -1)
if [ -n "$EXISTING_SITE" ] && grep -q 'server_name.*'$(echo "$DOMAIN" | sed 's/\./\\./g') "$EXISTING_SITE"; then
    if ! grep -q 'vibecoding/ws' "$EXISTING_SITE"; then
        sed -i "/listen 443 ssl/a\\$VIBECODING_LOCATION" "$EXISTING_SITE"
        echo "[OK] Injected /vibecoding/ws into $EXISTING_SITE"
    else
        echo "[OK] /vibecoding/ws already exists in $EXISTING_SITE"
    fi
else
    cat > "$NGINX_CONF" <<EOF
server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

$VIBECODING_LOCATION
}
EOF
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ 2>/dev/null || true
    echo "[OK] Created standalone config $NGINX_CONF"
fi

# SSL cert check
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo "[WARN] SSL cert not found at /etc/letsencrypt/live/$DOMAIN"
    echo "       Run: certbot --nginx -d $DOMAIN"
fi

nginx -t && systemctl reload nginx && echo "[OK] nginx reloaded"

# --- relay log directory ---
mkdir -p /var/log/relay

# --- fail2ban ---
echo "[6/6] Setting up fail2ban..."
mkdir -p /etc/fail2ban/filter.d
cat > /etc/fail2ban/filter.d/vibecoding-relay-auth.conf <<'EOF'
[Definition]
failregex = ^\{"time":".*","level":".*","event":"reject","ip":"<HOST>","reason":"auth_failed"
ignoreregex =
EOF

cat > /etc/fail2ban/jail.d/vibecoding-relay-auth.conf <<EOF
[vibecoding-relay-auth]
enabled = true
logpath = /var/log/relay/relay.log
filter = vibecoding-relay-auth
maxretry = 5
findtime = 600
bantime = 3600
EOF

systemctl restart fail2ban 2>/dev/null || echo "[WARN] fail2ban not running, install fail2ban first"
echo "[OK] fail2ban configured"

echo ""
echo "============================================"
echo "  Server setup complete!"
echo "============================================"
echo ""
echo "  Relay:     $RELAY_DIR"
echo "  Domain:    https://$DOMAIN/vibecoding/ws"
echo "  PC Token:  $(grep PC_TOKEN $TOKEN_FILE 2>/dev/null | cut -d= -f2)"
echo "  Phone Token: $(grep PHONE_TOKEN $TOKEN_FILE 2>/dev/null | cut -d= -f2)"
echo ""
echo "  Commands:"
echo "    systemctl status vibecoding-relay"
echo "    journalctl -u vibecoding-relay -f"
echo ""
