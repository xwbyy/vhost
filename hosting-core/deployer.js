/**
 * Deployer - Logic untuk deploy dari GitHub dan ZIP
 * Menangani: clone repo, ekstrak ZIP, install dependencies, build, dan start app
 */

const fs = require('fs-extra');
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const simpleGit = require('simple-git');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');

const portManager = require('./port-manager');
const detector = require('./detector');
const domains = require('./domains');

const execAsync = util.promisify(exec);

const SITES_DIR = path.join(__dirname, 'sites');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const APPS_FILE = path.join(__dirname, 'data', 'apps.json');

// Proses yang sedang berjalan (simulasi PM2)
const runningProcesses = new Map();

// Baca data aplikasi dari file
async function getAppsData() {
  try {
    await fs.ensureFile(APPS_FILE);
    const data = await fs.readJson(APPS_FILE);
    return data;
  } catch (error) {
    const defaultData = { apps: [] };
    await fs.writeJson(APPS_FILE, defaultData, { spaces: 2 });
    return defaultData;
  }
}

// Simpan data aplikasi ke file
async function saveAppsData(data) {
  await fs.writeJson(APPS_FILE, data, { spaces: 2 });
}

// Sanitasi nama aplikasi
function sanitizeAppName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

// Validasi URL GitHub
function isValidGitHubUrl(url) {
  const githubRegex = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
  return githubRegex.test(url);
}

// Cek apakah nama aplikasi sudah digunakan
async function isAppNameTaken(appName) {
  const appsData = await getAppsData();
  return appsData.apps.some(app => app.name === appName);
}

// Deploy dari GitHub repository
async function deployFromGitHub(repoUrl, appName, options = {}) {
  const sanitizedName = sanitizeAppName(appName);
  
  // Validasi
  if (!isValidGitHubUrl(repoUrl)) {
    throw new Error('URL GitHub tidak valid. Format: https://github.com/username/repository');
  }
  
  if (await isAppNameTaken(sanitizedName)) {
    throw new Error(`Nama aplikasi "${sanitizedName}" sudah digunakan. Pilih nama lain.`);
  }
  
  const appDir = path.join(SITES_DIR, sanitizedName);
  const sourceDir = path.join(appDir, 'source');
  const logsDir = path.join(appDir, 'logs');
  
  console.log(`[Deployer] Memulai deploy ${sanitizedName} dari ${repoUrl}`);
  
  try {
    // Buat direktori
    await fs.ensureDir(sourceDir);
    await fs.ensureDir(logsDir);
    
    // Clone repository
    console.log('[Deployer] Cloning repository...');
    const git = simpleGit();
    await git.clone(repoUrl, sourceDir, ['--depth', '1']);
    
    // Lanjutkan proses deploy
    return await finalizeDeploy(sanitizedName, sourceDir, appDir, {
      source: 'github',
      repoUrl,
      ...options
    });
    
  } catch (error) {
    // Cleanup jika gagal
    await fs.remove(appDir);
    throw error;
  }
}

// Deploy dari file ZIP
async function deployFromZip(zipPath, appName, options = {}) {
  const sanitizedName = sanitizeAppName(appName);
  
  if (await isAppNameTaken(sanitizedName)) {
    throw new Error(`Nama aplikasi "${sanitizedName}" sudah digunakan. Pilih nama lain.`);
  }
  
  const appDir = path.join(SITES_DIR, sanitizedName);
  const sourceDir = path.join(appDir, 'source');
  const logsDir = path.join(appDir, 'logs');
  
  console.log(`[Deployer] Memulai deploy ${sanitizedName} dari ZIP`);
  
  try {
    // Buat direktori
    await fs.ensureDir(sourceDir);
    await fs.ensureDir(logsDir);
    
    // Ekstrak ZIP
    console.log('[Deployer] Mengekstrak ZIP...');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(sourceDir, true);
    
    // Cek apakah ada folder wrapper (common pattern dari GitHub download)
    const contents = await fs.readdir(sourceDir);
    if (contents.length === 1) {
      const singleDir = path.join(sourceDir, contents[0]);
      const stat = await fs.stat(singleDir);
      if (stat.isDirectory()) {
        // Pindahkan isi folder ke sourceDir
        const innerContents = await fs.readdir(singleDir);
        for (const item of innerContents) {
          await fs.move(path.join(singleDir, item), path.join(sourceDir, item));
        }
        await fs.remove(singleDir);
      }
    }
    
    // Hapus file ZIP setelah ekstrak
    await fs.remove(zipPath);
    
    // Lanjutkan proses deploy
    return await finalizeDeploy(sanitizedName, sourceDir, appDir, {
      source: 'zip',
      ...options
    });
    
  } catch (error) {
    // Cleanup jika gagal
    await fs.remove(appDir);
    await fs.remove(zipPath);
    throw error;
  }
}

// Finalisasi proses deploy (install, build, start)
async function finalizeDeploy(appName, sourceDir, appDir, metadata = {}) {
  // Deteksi tipe project
  console.log('[Deployer] Mendeteksi tipe project...');
  const projectInfo = await detector.getProjectInfo(sourceDir);
  console.log(`[Deployer] Tipe terdeteksi: ${projectInfo.name}`);
  
  // Alokasikan port
  const port = await portManager.allocatePort(appName);
  console.log(`[Deployer] Port dialokasikan: ${port}`);
  
  // Install dependencies jika ada package.json
  const packageJsonPath = path.join(sourceDir, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    console.log('[Deployer] Installing dependencies...');
    try {
      await execAsync('npm install --production', { cwd: sourceDir, timeout: 300000 });
      console.log('[Deployer] Dependencies installed');
    } catch (error) {
      console.error('[Deployer] Warning: npm install gagal:', error.message);
    }
    
    // Build jika ada
    if (projectInfo.buildCommand) {
      console.log(`[Deployer] Building: ${projectInfo.buildCommand}`);
      try {
        await execAsync(projectInfo.buildCommand, { cwd: sourceDir, timeout: 600000 });
        console.log('[Deployer] Build selesai');
      } catch (error) {
        console.error('[Deployer] Warning: Build gagal:', error.message);
      }
    }
  }
  
  // Generate PM2 config
  const pm2Config = detector.generatePM2Config(appName, sourceDir, port, projectInfo);
  await fs.writeJson(path.join(appDir, 'pm2.config.json'), pm2Config, { spaces: 2 });
  
  // Generate Nginx config
  const baseDomain = process.env.BASE_DOMAIN || 'localhost';
  const subdomain = domains.generateSubdomain(appName, baseDomain);
  const nginxConfig = await domains.generateNginxConfig(appName, port, subdomain);
  await domains.saveNginxConfig(appName, nginxConfig);
  
  // Simpan app config
  const appConfig = {
    id: uuidv4(),
    name: appName,
    port,
    domain: subdomain,
    projectType: projectInfo.type,
    projectInfo: {
      name: projectInfo.name,
      description: projectInfo.description
    },
    source: metadata.source,
    repoUrl: metadata.repoUrl || null,
    status: 'stopped',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceDir,
    appDir
  };
  
  await fs.writeJson(path.join(appDir, 'app.json'), appConfig, { spaces: 2 });
  
  // Tambahkan ke daftar apps
  const appsData = await getAppsData();
  appsData.apps.push(appConfig);
  await saveAppsData(appsData);
  
  console.log(`[Deployer] Deploy selesai: ${appName}`);
  
  // Auto-start aplikasi
  await startApp(appName);
  
  return appConfig;
}

// Start aplikasi (simulasi PM2)
async function startApp(appName) {
  const appsData = await getAppsData();
  const appIndex = appsData.apps.findIndex(a => a.name === appName);
  
  if (appIndex === -1) {
    throw new Error(`Aplikasi "${appName}" tidak ditemukan`);
  }
  
  const app = appsData.apps[appIndex];
  
  if (runningProcesses.has(appName)) {
    console.log(`[Deployer] ${appName} sudah berjalan`);
    return app;
  }
  
  const sourceDir = app.sourceDir;
  const port = app.port;
  
  console.log(`[Deployer] Memulai ${appName} di port ${port}...`);
  
  // Cek apakah ada package.json dengan start script
  const packageJsonPath = path.join(sourceDir, 'package.json');
  let startCommand = 'node';
  let startArgs = ['index.js'];
  
  if (await fs.pathExists(packageJsonPath)) {
    const pkg = await fs.readJson(packageJsonPath);
    if (pkg.scripts && pkg.scripts.start) {
      startCommand = 'npm';
      startArgs = ['start'];
    }
  }
  
  // Jalankan proses
  const child = spawn(startCommand, startArgs, {
    cwd: sourceDir,
    env: { ...process.env, PORT: port, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  // Simpan log
  const logsDir = path.join(app.appDir, 'logs');
  await fs.ensureDir(logsDir);
  
  const outLog = fs.createWriteStream(path.join(logsDir, 'out.log'), { flags: 'a' });
  const errLog = fs.createWriteStream(path.join(logsDir, 'error.log'), { flags: 'a' });
  
  child.stdout.pipe(outLog);
  child.stderr.pipe(errLog);
  
  runningProcesses.set(appName, {
    process: child,
    pid: child.pid,
    startedAt: new Date().toISOString()
  });
  
  child.on('exit', (code) => {
    console.log(`[Deployer] ${appName} berhenti dengan kode ${code}`);
    runningProcesses.delete(appName);
    updateAppStatus(appName, 'stopped');
  });
  
  // Update status
  appsData.apps[appIndex].status = 'running';
  appsData.apps[appIndex].pid = child.pid;
  appsData.apps[appIndex].updatedAt = new Date().toISOString();
  await saveAppsData(appsData);
  
  return appsData.apps[appIndex];
}

// Stop aplikasi
async function stopApp(appName) {
  const processInfo = runningProcesses.get(appName);
  
  if (processInfo) {
    processInfo.process.kill('SIGTERM');
    runningProcesses.delete(appName);
  }
  
  await updateAppStatus(appName, 'stopped');
  console.log(`[Deployer] ${appName} dihentikan`);
}

// Restart aplikasi
async function restartApp(appName) {
  await stopApp(appName);
  await new Promise(resolve => setTimeout(resolve, 1000));
  return await startApp(appName);
}

// Update status aplikasi
async function updateAppStatus(appName, status) {
  const appsData = await getAppsData();
  const appIndex = appsData.apps.findIndex(a => a.name === appName);
  
  if (appIndex > -1) {
    appsData.apps[appIndex].status = status;
    appsData.apps[appIndex].updatedAt = new Date().toISOString();
    if (status === 'stopped') {
      delete appsData.apps[appIndex].pid;
    }
    await saveAppsData(appsData);
  }
}

// Dapatkan status aplikasi
async function getAppStatus(appName) {
  const appsData = await getAppsData();
  const app = appsData.apps.find(a => a.name === appName);
  
  if (!app) return null;
  
  const isRunning = runningProcesses.has(appName);
  return {
    ...app,
    status: isRunning ? 'running' : 'stopped',
    isRunning
  };
}

// Dapatkan semua aplikasi
async function getAllApps() {
  const appsData = await getAppsData();
  
  return appsData.apps.map(app => ({
    ...app,
    status: runningProcesses.has(app.name) ? 'running' : 'stopped',
    isRunning: runningProcesses.has(app.name)
  }));
}

// Hapus aplikasi
async function deleteApp(appName) {
  // Stop dulu jika berjalan
  await stopApp(appName);
  
  const appsData = await getAppsData();
  const appIndex = appsData.apps.findIndex(a => a.name === appName);
  
  if (appIndex === -1) {
    throw new Error(`Aplikasi "${appName}" tidak ditemukan`);
  }
  
  const app = appsData.apps[appIndex];
  
  // Lepaskan port
  await portManager.releasePort(app.port);
  
  // Hapus folder aplikasi
  await fs.remove(app.appDir);
  
  // Hapus dari daftar
  appsData.apps.splice(appIndex, 1);
  await saveAppsData(appsData);
  
  // Hapus Nginx config
  const nginxConfigPath = path.join(__dirname, 'nginx', `${appName}.conf`);
  await fs.remove(nginxConfigPath);
  
  console.log(`[Deployer] ${appName} dihapus`);
}

// Dapatkan log aplikasi
async function getAppLogs(appName, type = 'out', lines = 100) {
  const appsData = await getAppsData();
  const app = appsData.apps.find(a => a.name === appName);
  
  if (!app) {
    throw new Error(`Aplikasi "${appName}" tidak ditemukan`);
  }
  
  const logFile = path.join(app.appDir, 'logs', `${type}.log`);
  
  if (!await fs.pathExists(logFile)) {
    return '';
  }
  
  const content = await fs.readFile(logFile, 'utf-8');
  const logLines = content.split('\n');
  
  return logLines.slice(-lines).join('\n');
}

module.exports = {
  deployFromGitHub,
  deployFromZip,
  startApp,
  stopApp,
  restartApp,
  getAppStatus,
  getAllApps,
  deleteApp,
  getAppLogs,
  sanitizeAppName,
  isValidGitHubUrl,
  isAppNameTaken
};
