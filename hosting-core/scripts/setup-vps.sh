#!/bin/bash
#
# Script Setup VPS untuk Hosting Mandiri
# Platform Self-Hosted Deployment seperti Vercel
#
# Dijalankan di: Ubuntu 20.04 / 22.04
# Jalankan sebagai root atau dengan sudo
#

set -e

echo "╔════════════════════════════════════════════╗"
echo "║   SETUP HOSTING MANDIRI - VPS Ubuntu       ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Cek apakah dijalankan sebagai root
if [ "$EUID" -ne 0 ]; then
  echo "Harap jalankan script ini sebagai root atau dengan sudo"
  exit 1
fi

# Variabel konfigurasi
HOSTING_USER="hosting"
HOSTING_DIR="/var/www/hosting"
NODE_VERSION="20"
DOMAIN=${1:-"example.com"}

echo "[1/8] Update sistem..."
apt update && apt upgrade -y

echo "[2/8] Install dependencies..."
apt install -y curl wget git nginx certbot python3-certbot-nginx ufw

echo "[3/8] Install Node.js ${NODE_VERSION}..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt install -y nodejs

echo "[4/8] Install PM2..."
npm install -g pm2

echo "[5/8] Buat user hosting..."
if ! id "$HOSTING_USER" &>/dev/null; then
  useradd -m -s /bin/bash $HOSTING_USER
  echo "User $HOSTING_USER berhasil dibuat"
else
  echo "User $HOSTING_USER sudah ada"
fi

echo "[6/8] Setup direktori..."
mkdir -p $HOSTING_DIR
chown -R $HOSTING_USER:$HOSTING_USER $HOSTING_DIR

echo "[7/8] Konfigurasi firewall..."
ufw allow 'Nginx Full'
ufw allow OpenSSH
ufw --force enable

echo "[8/8] Setup PM2 startup..."
pm2 startup systemd -u $HOSTING_USER --hp /home/$HOSTING_USER
systemctl enable pm2-$HOSTING_USER

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║           SETUP SELESAI!                   ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "Langkah selanjutnya:"
echo "1. Copy folder hosting-core ke $HOSTING_DIR"
echo "2. cd $HOSTING_DIR && npm install"
echo "3. pm2 start server.js --name hosting-core"
echo "4. pm2 save"
echo ""
echo "Untuk setup SSL:"
echo "certbot --nginx -d $DOMAIN"
echo ""
