/**
 * Domain Manager - Mengelola domain dan konfigurasi Nginx
 * Mendukung subdomain dan custom domain dengan SSL otomatis
 */

const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

const NGINX_SITES_PATH = '/etc/nginx/sites-available';
const NGINX_ENABLED_PATH = '/etc/nginx/sites-enabled';
const TEMPLATE_PATH = path.join(__dirname, 'nginx', 'site-template.conf');

// Generate konfigurasi Nginx untuk aplikasi
async function generateNginxConfig(appName, port, domain, options = {}) {
  const { ssl = false, customDomain = null } = options;
  
  const serverName = customDomain || domain;
  const upstreamName = `upstream_${appName.replace(/-/g, '_')}`;
  
  let config = `
# Konfigurasi Nginx untuk ${appName}
# Generated at: ${new Date().toISOString()}

upstream ${upstreamName} {
    server 127.0.0.1:${port};
    keepalive 64;
}

server {
    listen 80;
    server_name ${serverName};
    
    # Redirect HTTP ke HTTPS jika SSL aktif
    ${ssl ? 'return 301 https://$server_name$request_uri;' : ''}
    
    ${!ssl ? `
    location / {
        proxy_pass http://${upstreamName};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
    ` : ''}
}

${ssl ? `
server {
    listen 443 ssl http2;
    server_name ${serverName};
    
    ssl_certificate /etc/letsencrypt/live/${serverName}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${serverName}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    
    add_header Strict-Transport-Security "max-age=63072000" always;
    
    location / {
        proxy_pass http://${upstreamName};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
` : ''}
`;
  
  return config.trim();
}

// Simpan konfigurasi Nginx (untuk simulasi di Replit)
async function saveNginxConfig(appName, config) {
  const configPath = path.join(__dirname, 'nginx', `${appName}.conf`);
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, config);
  console.log(`[Domains] Konfigurasi Nginx disimpan: ${configPath}`);
  return configPath;
}

// Simulasi reload Nginx (di VPS sebenarnya: sudo nginx -t && sudo systemctl reload nginx)
async function reloadNginx() {
  console.log('[Domains] Simulasi reload Nginx...');
  // Di VPS sebenarnya:
  // await execAsync('sudo nginx -t && sudo systemctl reload nginx');
  return true;
}

// Generate command SSL dengan Certbot
function generateSSLCommand(domain, email = 'admin@example.com') {
  return `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos -m ${email}`;
}

// Setup SSL untuk domain (simulasi)
async function setupSSL(domain, email) {
  console.log(`[Domains] Simulasi setup SSL untuk ${domain}...`);
  const command = generateSSLCommand(domain, email);
  console.log(`[Domains] Command SSL: ${command}`);
  // Di VPS sebenarnya:
  // await execAsync(command);
  return {
    success: true,
    message: `SSL akan disetup dengan command: ${command}`,
    command
  };
}

// Generate subdomain dari nama aplikasi
function generateSubdomain(appName, baseDomain) {
  const sanitized = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${sanitized}.${baseDomain}`;
}

// Validasi format domain
function isValidDomain(domain) {
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i;
  return domainRegex.test(domain);
}

// Generate script setup VPS
function generateVPSSetupScript(apps, baseDomain) {
  let script = `#!/bin/bash
# Script Setup VPS untuk Hosting Platform
# Generated at: ${new Date().toISOString()}

set -e

echo "=== Setup Hosting Platform ==="

# Update sistem
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y nginx certbot python3-certbot-nginx nodejs npm

# Install PM2 globally
sudo npm install -g pm2

# Buat user untuk hosting
sudo useradd -m -s /bin/bash hosting || true

# Setup firewall
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw --force enable

# Buat direktori
sudo mkdir -p /var/www/hosting
sudo chown hosting:hosting /var/www/hosting

`;
  
  // Tambahkan konfigurasi untuk setiap app
  apps.forEach(app => {
    script += `
# Setup ${app.name}
echo "Setting up ${app.name}..."
`;
  });
  
  script += `
# Enable dan start Nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Setup PM2 startup
pm2 startup systemd -u hosting --hp /home/hosting
pm2 save

echo "=== Setup Selesai ==="
`;
  
  return script;
}

module.exports = {
  generateNginxConfig,
  saveNginxConfig,
  reloadNginx,
  setupSSL,
  generateSubdomain,
  isValidDomain,
  generateSSLCommand,
  generateVPSSetupScript
};
