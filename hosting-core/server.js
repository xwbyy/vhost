/**
 * Server Utama - Platform Hosting Mandiri v2.0
 * Backend Express.js dengan Google Sheets Database
 * Siap deploy ke Vercel
 */

const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs-extra');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { WebSocketServer } = require('ws');
const http = require('http');
const { spawn } = require('child_process');

const deployer = require('./deployer');
const portManager = require('./port-manager');
const detector = require('./detector');
const domains = require('./domains');
const db = require('./lib/sheets-db');
const auth = require('./lib/auth');
const { authMiddleware, requireAuth, requireAdmin, requireVIP } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'hosting-mandiri-secret-2024';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file ZIP yang diizinkan'), false);
    }
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

app.use(authMiddleware);

app.use(async (req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.appName = 'Hosting Mandiri';
  res.locals.user = req.user || null;
  next();
});

app.get('/', async (req, res) => {
  try {
    const apps = await deployer.getAllApps();
    const stats = {
      totalApps: apps.length,
      runningApps: apps.filter(a => a.isRunning).length,
      stoppedApps: apps.filter(a => !a.isRunning).length
    };
    res.render('index', { stats, recentApps: apps.slice(-5).reverse() });
  } catch (error) {
    res.render('index', { stats: { totalApps: 0, runningApps: 0, stoppedApps: 0 }, recentApps: [] });
  }
});

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await auth.login(username, password, {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    res.cookie('token', result.token, { 
      httpOnly: true, 
      maxAge: 7 * 24 * 60 * 60 * 1000 
    });
    res.redirect('/');
  } catch (error) {
    res.render('login', { error: error.message });
  }
});

app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { error: null, success: null });
});

app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const result = await auth.register({ username, email, password });
    res.cookie('token', result.token, { 
      httpOnly: true, 
      maxAge: 7 * 24 * 60 * 60 * 1000 
    });
    res.redirect('/');
  } catch (error) {
    res.render('register', { error: error.message, success: null });
  }
});

app.get('/logout', async (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    await auth.logout(token);
  }
  res.clearCookie('token');
  res.redirect('/login');
});

app.get('/profile', requireAuth, async (req, res) => {
  try {
    const stats = await auth.getUserStats(req.user.id);
    const logs = await db.findMany('Logs', { user_id: req.user.id });
    res.render('profile', { stats, logs: logs.reverse(), message: null });
  } catch (error) {
    res.render('profile', { stats: {}, logs: [], message: null });
  }
});

app.post('/profile/update', requireAuth, async (req, res) => {
  try {
    await auth.updateProfile(req.user.id, req.body);
    const stats = await auth.getUserStats(req.user.id);
    const logs = await db.findMany('Logs', { user_id: req.user.id });
    res.render('profile', { stats, logs: logs.reverse(), message: 'Profil berhasil diperbarui' });
  } catch (error) {
    const stats = await auth.getUserStats(req.user.id);
    res.render('profile', { stats, logs: [], message: error.message });
  }
});

app.get('/deploy', requireAuth, (req, res) => {
  res.render('deploy', { error: null, success: null });
});

app.get('/apps', requireAuth, async (req, res) => {
  try {
    const apps = await deployer.getAllApps();
    res.render('apps', { apps, error: null });
  } catch (error) {
    res.render('apps', { apps: [], error: error.message });
  }
});

app.get('/apps/:name', requireAuth, async (req, res) => {
  try {
    const app = await deployer.getAppStatus(req.params.name);
    if (!app) {
      return res.status(404).render('error', { 
        message: 'Aplikasi tidak ditemukan',
        error: { status: 404 }
      });
    }
    const logs = await deployer.getAppLogs(req.params.name, 'out', 50);
    const errorLogs = await deployer.getAppLogs(req.params.name, 'error', 50);
    res.render('app-detail', { app, logs, errorLogs });
  } catch (error) {
    res.status(500).render('error', { 
      message: error.message,
      error: { status: 500 }
    });
  }
});

app.get('/logs/:name', requireAuth, async (req, res) => {
  try {
    const app = await deployer.getAppStatus(req.params.name);
    if (!app) {
      return res.status(404).render('error', { 
        message: 'Aplikasi tidak ditemukan',
        error: { status: 404 }
      });
    }
    res.render('logs', { app });
  } catch (error) {
    res.status(500).render('error', { 
      message: error.message,
      error: { status: 500 }
    });
  }
});

app.get('/terminal', requireAuth, async (req, res) => {
  try {
    const apps = await deployer.getAllApps();
    res.render('terminal', { apps });
  } catch (error) {
    res.render('terminal', { apps: [] });
  }
});

app.get('/dbadmin', requireAdmin, async (req, res) => {
  try {
    await db.init();
    const users = await db.getAll('Users');
    const apps = await deployer.getAllApps();
    const logs = await db.getAll('Logs');
    
    const stats = {
      totalUsers: users.length,
      vipUsers: users.filter(u => u.tier === 'vip').length,
      totalApps: apps.length,
      runningApps: apps.filter(a => a.isRunning).length
    };
    
    res.render('dbadmin/index', { 
      stats, 
      recentUsers: users.reverse().slice(0, 5),
      recentLogs: logs.reverse().slice(0, 10)
    });
  } catch (error) {
    res.render('dbadmin/index', { 
      stats: { totalUsers: 0, vipUsers: 0, totalApps: 0, runningApps: 0 },
      recentUsers: [],
      recentLogs: []
    });
  }
});

app.get('/dbadmin/users', requireAdmin, async (req, res) => {
  try {
    const users = await auth.getAllUsers();
    res.render('dbadmin/users', { users, message: null });
  } catch (error) {
    res.render('dbadmin/users', { users: [], message: error.message });
  }
});

app.get('/dbadmin/settings', requireAdmin, async (req, res) => {
  try {
    await db.init();
    const settingsList = await db.getAll('Settings');
    const settings = {};
    settingsList.forEach(s => settings[s.key] = s.value);
    res.render('dbadmin/settings', { settings, message: null });
  } catch (error) {
    res.render('dbadmin/settings', { settings: {}, message: error.message });
  }
});

app.post('/api/deploy/github', requireAuth, async (req, res) => {
  try {
    const { repoUrl, appName } = req.body;
    
    if (!repoUrl || !appName) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL repository dan nama aplikasi wajib diisi' 
      });
    }

    const stats = await auth.getUserStats(req.user.id);
    if (stats.totalApps >= stats.maxApps) {
      return res.status(403).json({
        success: false,
        error: `Batas aplikasi tercapai (${stats.maxApps}). Upgrade ke VIP untuk lebih banyak.`
      });
    }
    
    const app = await deployer.deployFromGitHub(repoUrl, appName);
    res.json({ success: true, app });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/deploy/zip', requireAuth, upload.single('zipFile'), async (req, res) => {
  try {
    const { appName } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'File ZIP wajib diupload' 
      });
    }
    
    if (!appName) {
      await fs.remove(req.file.path);
      return res.status(400).json({ 
        success: false, 
        error: 'Nama aplikasi wajib diisi' 
      });
    }

    const stats = await auth.getUserStats(req.user.id);
    if (stats.totalApps >= stats.maxApps) {
      await fs.remove(req.file.path);
      return res.status(403).json({
        success: false,
        error: `Batas aplikasi tercapai (${stats.maxApps}). Upgrade ke VIP untuk lebih banyak.`
      });
    }
    
    const app = await deployer.deployFromZip(req.file.path, appName);
    res.json({ success: true, app });
  } catch (error) {
    if (req.file) {
      await fs.remove(req.file.path);
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/check-name/:name', async (req, res) => {
  try {
    const sanitized = deployer.sanitizeAppName(req.params.name);
    const taken = await deployer.isAppNameTaken(sanitized);
    res.json({ 
      available: !taken, 
      sanitizedName: sanitized,
      message: taken ? 'Nama sudah digunakan' : 'Nama tersedia'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/apps', requireAuth, async (req, res) => {
  try {
    const apps = await deployer.getAllApps();
    res.json({ success: true, apps });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/apps/:name', requireAuth, async (req, res) => {
  try {
    const app = await deployer.getAppStatus(req.params.name);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Aplikasi tidak ditemukan' });
    }
    res.json({ success: true, app });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/apps/:name/start', requireAuth, async (req, res) => {
  try {
    const app = await deployer.startApp(req.params.name);
    res.json({ success: true, app, message: 'Aplikasi berhasil dijalankan' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/apps/:name/stop', requireAuth, async (req, res) => {
  try {
    await deployer.stopApp(req.params.name);
    res.json({ success: true, message: 'Aplikasi berhasil dihentikan' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/apps/:name/restart', requireAuth, async (req, res) => {
  try {
    const app = await deployer.restartApp(req.params.name);
    res.json({ success: true, app, message: 'Aplikasi berhasil direstart' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/apps/:name', requireAuth, async (req, res) => {
  try {
    await deployer.deleteApp(req.params.name);
    res.json({ success: true, message: 'Aplikasi berhasil dihapus' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/apps/:name/logs', requireAuth, async (req, res) => {
  try {
    const { type = 'out', lines = 100 } = req.query;
    const logs = await deployer.getAppLogs(req.params.name, type, parseInt(lines));
    res.json({ success: true, logs });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { username, email, password, tier, is_admin } = req.body;
    const result = await auth.register({ username, email, password });
    
    if (tier || is_admin) {
      await auth.updateUser(result.user.id, {
        tier: tier || 'free',
        is_admin: is_admin ? 'true' : 'false'
      });
    }
    
    res.redirect('/dbadmin/users');
  } catch (error) {
    res.redirect('/dbadmin/users?error=' + encodeURIComponent(error.message));
  }
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await auth.updateUser(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await auth.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    await db.init();
    const fields = ['site_name', 'allow_registration', 'maintenance_mode', 'terminal_enabled',
                   'max_apps_free', 'max_apps_vip', 'max_storage_free', 'max_storage_vip'];
    
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        const value = typeof req.body[field] === 'boolean' 
          ? (req.body[field] ? 'true' : 'false')
          : req.body[field].toString();
        await db.setSetting(field, value);
      } else if (['allow_registration', 'maintenance_mode', 'terminal_enabled'].includes(field)) {
        await db.setSetting(field, 'false');
      }
    }
    
    res.redirect('/dbadmin/settings');
  } catch (error) {
    res.redirect('/dbadmin/settings?error=' + encodeURIComponent(error.message));
  }
});

app.post('/api/admin/clear-cache', requireAdmin, (req, res) => {
  res.json({ success: true, message: 'Cache cleared' });
});

app.post('/api/admin/sync-database', requireAdmin, async (req, res) => {
  try {
    await db.init();
    res.json({ success: true, message: 'Database synced' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/setup-script', requireAuth, async (req, res) => {
  try {
    const apps = await deployer.getAllApps();
    const baseDomain = req.query.domain || 'example.com';
    const script = domains.generateVPSSetupScript(apps, baseDomain);
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="setup-vps.sh"');
    res.send(script);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const activeTerminals = new Map();

wss.on('connection', async (ws, req) => {
  const appName = req.url.split('/').pop();
  console.log(`[WS] Terminal connected for app: ${appName}`);
  
  let currentProcess = null;
  let appSourceDir = null;

  try {
    const appStatus = await deployer.getAppStatus(appName);
    if (appStatus) {
      appSourceDir = appStatus.sourceDir;
    }
    
    const outLogs = await deployer.getAppLogs(appName, 'out', 50);
    const errorLogs = await deployer.getAppLogs(appName, 'error', 50);
    
    ws.send(JSON.stringify({
      type: 'logs',
      out: outLogs,
      error: errorLogs
    }));
    
    ws.send(JSON.stringify({
      type: 'output',
      content: `\x1b[32m✓ Terminal ready for ${appName}\x1b[0m\r\n`
    }));
    
    if (appSourceDir) {
      ws.send(JSON.stringify({
        type: 'output',
        content: `\x1b[36mWorking directory: ${appSourceDir}\x1b[0m\r\n\r\n`
      }));
    }
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      content: 'Failed to load logs: ' + error.message
    }));
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'command') {
        const command = data.command.trim();
        
        if (!command) return;
        
        if (!appSourceDir) {
          ws.send(JSON.stringify({
            type: 'error',
            content: `\x1b[31mError: Application directory not found\x1b[0m\r\n`
          }));
          return;
        }
        
        const dangerousPatterns = [
          /[;&|`$]/, 
          /\$\(/, 
          /\|\|/, 
          /&&/, 
          />>?/, 
          /</, 
          /\bsh\b/, 
          /\bbash\b/, 
          /\bzsh\b/,
          /\beval\b/,
          /\bexec\b/,
          /rm\s+(-[rfRF]+\s+)?[\/\*]/,
          /\bsudo\b/,
          /\bchmod\b/,
          /\bchown\b/,
          /\bpasswd\b/,
          /\bdd\b/,
          /\bmkfs\b/,
          /\bformat\b/,
          /\bcurl\b.*\bsh\b/,
          /\bwget\b.*\bsh\b/,
          /\bpython\b/,
          /\bperl\b/,
          /\bruby\b/,
        ];
        
        if (dangerousPatterns.some(pattern => pattern.test(command))) {
          ws.send(JSON.stringify({
            type: 'error',
            content: `\x1b[31mCommand contains blocked pattern for security reasons\x1b[0m\r\n`
          }));
          return;
        }
        
        const safeCommands = {
          'npm': ['start', 'install', 'test', 'run dev', 'run build', 'run start', 'ls', 'list', 'outdated', 'version', '-v', '--version'],
          'node': ['index.js', 'server.js', 'main.js', 'app.js', 'bot.js', '--version', '-v'],
          'ls': true,
          'cat': true,
          'head': true,
          'tail': true,
          'pwd': true,
          'clear': true,
          'ps': ['aux', '-a'],
        };
        
        const parts = command.trim().split(/\s+/);
        const baseCmd = parts[0].replace(/^.*\//, '');
        const cmdArgs = parts.slice(1);
        const subCmd = cmdArgs.join(' ');
        
        if (!safeCommands.hasOwnProperty(baseCmd)) {
          ws.send(JSON.stringify({
            type: 'error',
            content: `\x1b[31mCommand '${baseCmd}' is not allowed. Use: npm, node, ls, cat, head, tail, pwd, clear, ps\x1b[0m\r\n`
          }));
          return;
        }
        
        if (baseCmd === 'node' && cmdArgs.some(arg => arg.startsWith('-e') || arg.startsWith('--eval') || arg.startsWith('-p') || arg.startsWith('--print'))) {
          ws.send(JSON.stringify({
            type: 'error',
            content: `\x1b[31mnode -e/--eval is not allowed for security reasons\x1b[0m\r\n`
          }));
          return;
        }
        
        if (baseCmd === 'npm' && cmdArgs.some(arg => arg === 'set' || arg === 'config' || arg === 'exec' || arg === 'npx')) {
          ws.send(JSON.stringify({
            type: 'error',
            content: `\x1b[31mnpm ${cmdArgs[0]} is not allowed for security reasons\x1b[0m\r\n`
          }));
          return;
        }
        
        const allowedSub = safeCommands[baseCmd];
        if (Array.isArray(allowedSub) && subCmd !== '') {
          const subMatch = allowedSub.some(s => subCmd.startsWith(s));
          if (!subMatch) {
            ws.send(JSON.stringify({
              type: 'error',
              content: `\x1b[31mSubcommand not allowed. For ${baseCmd}, use: ${allowedSub.join(', ')}\x1b[0m\r\n`
            }));
            return;
          }
        }
        
        ws.send(JSON.stringify({
          type: 'output',
          content: `\x1b[33m$ ${command}\x1b[0m\r\n`
        }));
        
        if (currentProcess) {
          currentProcess.kill('SIGTERM');
          currentProcess = null;
        }
        
        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
        const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];
        
        currentProcess = spawn(shell, shellArgs, {
          cwd: appSourceDir,
          env: { 
            ...process.env, 
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TERM: 'xterm-256color',
            FORCE_COLOR: '1'
          },
          shell: false
        });
        
        activeTerminals.set(ws, currentProcess);
        
        currentProcess.stdout.on('data', (data) => {
          const output = data.toString().replace(/\n/g, '\r\n');
          ws.send(JSON.stringify({
            type: 'output',
            content: output
          }));
        });
        
        currentProcess.stderr.on('data', (data) => {
          const output = data.toString().replace(/\n/g, '\r\n');
          ws.send(JSON.stringify({
            type: 'output',
            content: `\x1b[31m${output}\x1b[0m`
          }));
        });
        
        currentProcess.on('close', (code) => {
          ws.send(JSON.stringify({
            type: 'output',
            content: `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`
          }));
          currentProcess = null;
          activeTerminals.delete(ws);
        });
        
        currentProcess.on('error', (error) => {
          ws.send(JSON.stringify({
            type: 'error',
            content: `\x1b[31mError: ${error.message}\x1b[0m\r\n`
          }));
          currentProcess = null;
          activeTerminals.delete(ws);
        });
        
      } else if (data.type === 'signal') {
        if (currentProcess) {
          if (data.signal === 'SIGINT') {
            currentProcess.kill('SIGINT');
            ws.send(JSON.stringify({
              type: 'output',
              content: '\r\n\x1b[33m^C\x1b[0m\r\n'
            }));
          } else if (data.signal === 'SIGTERM') {
            currentProcess.kill('SIGTERM');
          }
        }
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        content: `\x1b[31m${error.message}\x1b[0m\r\n`
      }));
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Terminal disconnected for app: ${appName}`);
    if (currentProcess) {
      currentProcess.kill('SIGTERM');
      currentProcess = null;
    }
    activeTerminals.delete(ws);
  });
});

app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.message);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        error: 'Ukuran file melebihi batas maksimal (100MB)' 
      });
    }
  }
  
  res.status(500).json({ 
    success: false, 
    error: err.message || 'Terjadi kesalahan internal' 
  });
});

app.use((req, res) => {
  res.status(404).render('error', { 
    message: 'Halaman tidak ditemukan',
    error: { status: 404 }
  });
});

async function startServer() {
  try {
    console.log('[Server] Initializing database...');
    await db.init();
    console.log('[Server] Database ready');
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔════════════════════════════════════════════════╗
║     🚀 HOSTING MANDIRI v2.0                    ║
║     Platform Deploy Self-Hosted                ║
╠════════════════════════════════════════════════╣
║  Server berjalan di port ${PORT}                  ║
║  http://localhost:${PORT}                         ║
║                                                ║
║  Database: Google Sheets                       ║
║  Ready for Vercel deployment                   ║
╚════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error.message);
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Running without database on port ${PORT}`);
    });
  }
}

startServer();

module.exports = app;
