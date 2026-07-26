#!/bin/bash
set -e

RELAY_DIR="/opt/vibecoding-relay"
DOMAIN="${1:-wxysyn.com}"
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
    PC_TOKEN=$(openssl rand -hex 16)
    PHONE_TOKEN=$(openssl rand -hex 16)
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

# --- nginx ---
echo "[5/6] Configuring nginx..."
NGINX_CONF="/etc/nginx/sites-available/vibecoding"
cat > "$NGINX_CONF" <<EOF
server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location /vibecoding/ws {
        proxy_pass http://127.0.0.1:8766;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
EOF

# Enable if nginx config test passes
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ 2>/dev/null || true
    nginx -t && systemctl reload nginx
    echo "[OK] nginx configured for $DOMAIN"
else
    echo "[WARN] SSL cert not found at /etc/letsencrypt/live/$DOMAIN"
    echo "       Run: certbot --nginx -d $DOMAIN"
    echo "       Then enable: ln -s $NGINX_CONF /etc/nginx/sites-enabled/"
fi

# --- fail2ban ---
echo "[6/6] Setting up fail2ban..."
mkdir -p /etc/fail2ban/filter.d
cat > /etc/fail2ban/filter.d/vibecoding-relay-auth.conf <<EOF
[Definition]
failregex = ^.*REJECT .* - auth failed$
ignoreregex =
EOF

cat > /etc/fail2ban/jail.d/vibecoding-relay-auth.conf <<EOF
[vibecoding-relay-auth]
enabled = true
logpath = $RELAY_DIR/relay.log
filter = vibecoding-relay-auth
maxretry = 5
findtime = 600
bantime = 3600
action = iptables-allports
EOF

systemctl restart fail2ban 2>/dev/null || echo "[WARN] fail2ban not running, start it manually"
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
