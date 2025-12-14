# Hosting Mandiri - Platform Self-Hosted Deployment v2.0

## Overview
Platform hosting mandiri seperti Vercel versi sederhana. Mendukung deploy dari GitHub dan file ZIP dengan auto-detection tipe project. Menggunakan Google Sheets sebagai database (Vercel-ready, tanpa SQL).

## Project Structure
```
hosting-core/
├── server.js              # Backend utama Express.js
├── deployer.js            # Logic deploy GitHub & ZIP
├── detector.js            # Deteksi tipe project (Next.js, Vite, Express, Bot)
├── port-manager.js        # Alokasi port otomatis
├── domains.js             # Domain & Nginx config handler
├── lib/
│   ├── sheets-db.js       # Google Sheets database module
│   └── auth.js            # Authentication & session management
├── middleware/
│   └── auth.js            # Auth middleware (requireAuth, requireAdmin, requireVIP)
├── data/
│   ├── apps.json          # Data semua aplikasi
│   └── ports.json         # Port yang terpakai
├── sites/                 # Folder aplikasi yang di-deploy
├── uploads/               # Temporary upload folder
├── views/                 # EJS templates (Bahasa Indonesia)
│   ├── index.ejs          # Homepage dengan stats
│   ├── login.ejs          # Halaman login
│   ├── register.ejs       # Halaman registrasi
│   ├── profile.ejs        # Profil user dengan tabs
│   ├── deploy.ejs         # Deploy GitHub/ZIP
│   ├── terminal.ejs       # Live terminal dengan xterm.js
│   ├── apps.ejs           # Daftar aplikasi
│   ├── app-detail.ejs     # Detail aplikasi
│   ├── logs.ejs           # View logs
│   └── dbadmin/           # Admin panel
│       ├── index.ejs      # Dashboard admin
│       ├── users.ejs      # Manajemen user
│       └── settings.ejs   # Pengaturan website
├── public/
│   ├── css/style.css      # Custom CSS dengan dark mode
│   └── js/app.js          # Frontend JS dengan theme toggle
├── vercel.json            # Konfigurasi Vercel deployment
└── package.json           # Dependencies
```

## Tech Stack
- **Backend**: Node.js + Express.js
- **Template Engine**: EJS (full HTML dalam setiap view)
- **Database**: Google Sheets (via googleapis)
- **Authentication**: JWT + bcryptjs + express-session
- **Frontend**: Bootstrap 5 + Bootstrap Icons
- **Terminal**: xterm.js + WebSocket
- **Process Manager**: Simulasi PM2 (child_process)

## Fitur Utama
1. Deploy dari GitHub repository
2. Deploy dari file ZIP upload
3. Auto-deteksi tipe project
4. Port management otomatis
5. Template Nginx untuk VPS
6. Dashboard Bahasa Indonesia
7. Start/Stop/Restart aplikasi
8. View logs realtime
9. User tiers (Free & VIP)
10. Admin panel (/dbadmin)
11. Live Terminal dengan WebSocket
12. Dark mode support
13. Responsive mobile design

## User Tiers
- **Free**: 3 aplikasi, 100MB storage
- **VIP**: 20 aplikasi, 1GB storage, custom domain

## Database Sheets (Auto-created)
1. **Users**: id, username, email, password, tier, created_at, last_login, is_admin, status, avatar
2. **Sessions**: id, user_id, token, created_at, expires_at, ip_address, user_agent
3. **Apps**: id, user_id, name, type, status, port, created_at, last_deploy, domain, config
4. **Logs**: id, user_id, app_id, type, message, created_at, level
5. **Settings**: key, value, description, updated_at
6. **Analytics**: id, user_id, app_id, event, data, created_at, ip_address

## Environment Variables (Secrets)
- GOOGLE_CLIENT_EMAIL
- GOOGLE_PRIVATE_KEY
- GOOGLE_PRIVATE_KEY_ID
- GOOGLE_PROJECT_ID
- GOOGLE_SHEET_ID

## Running Locally
```bash
cd hosting-core
npm install
npm start
```
Server berjalan di http://localhost:5000

## Deploy ke Vercel
1. Push ke GitHub
2. Import ke Vercel
3. Set environment variables di Vercel dashboard
4. Deploy

## API Endpoints
- `POST /api/deploy/github` - Deploy dari GitHub
- `POST /api/deploy/zip` - Deploy dari ZIP
- `GET /api/apps` - List semua aplikasi
- `POST /api/apps/:name/start` - Start aplikasi
- `POST /api/apps/:name/stop` - Stop aplikasi
- `POST /api/apps/:name/restart` - Restart aplikasi
- `DELETE /api/apps/:name` - Hapus aplikasi
- `GET /api/apps/:name/logs` - Get logs aplikasi
- `POST /api/admin/users` - Tambah user (admin only)
- `PATCH /api/admin/users/:id` - Update user (admin only)
- `DELETE /api/admin/users/:id` - Hapus user (admin only)
- `POST /api/admin/settings` - Update settings (admin only)

## Recent Changes (Dec 2024)
- Added Google Sheets database integration
- Implemented full authentication system with JWT
- Created responsive UI with Bootstrap 5
- Added dark mode toggle
- Fixed private key parsing for various formats
- All EJS views now have complete HTML wrapper
- Admin panel with user management
- Live terminal with xterm.js

## User Preferences
- Bahasa Indonesia untuk semua UI
- Platform siap deploy ke Vercel
- Tidak menggunakan .env file (menggunakan Vercel env vars)
- Google Sheets sebagai database (no SQL)
