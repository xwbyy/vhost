/**
 * Project Detector - Mendeteksi tipe project berdasarkan package.json
 * Mendukung: Next.js, Vite, Express API, Bot Node.js, Static HTML
 */

const fs = require('fs-extra');
const path = require('path');

// Tipe project yang didukung
const PROJECT_TYPES = {
  NEXTJS: 'nextjs',
  VITE: 'vite',
  EXPRESS: 'express',
  BOT: 'bot',
  STATIC: 'static',
  UNKNOWN: 'unknown'
};

// Deteksi tipe project dari direktori
async function detectProjectType(projectDir) {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const indexHtmlPath = path.join(projectDir, 'index.html');
  
  // Cek apakah ada package.json
  if (await fs.pathExists(packageJsonPath)) {
    try {
      const packageJson = await fs.readJson(packageJsonPath);
      return analyzePackageJson(packageJson);
    } catch (error) {
      console.error('[Detector] Error membaca package.json:', error.message);
    }
  }
  
  // Cek apakah static HTML
  if (await fs.pathExists(indexHtmlPath)) {
    return {
      type: PROJECT_TYPES.STATIC,
      name: 'Static HTML Website',
      buildCommand: null,
      startCommand: null,
      description: 'Website HTML statis tanpa build process'
    };
  }
  
  return {
    type: PROJECT_TYPES.UNKNOWN,
    name: 'Unknown',
    buildCommand: null,
    startCommand: null,
    description: 'Tipe project tidak terdeteksi'
  };
}

// Analisis package.json untuk menentukan tipe project
function analyzePackageJson(packageJson) {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };
  
  const scripts = packageJson.scripts || {};
  
  // Deteksi Next.js
  if (dependencies['next']) {
    return {
      type: PROJECT_TYPES.NEXTJS,
      name: 'Next.js',
      buildCommand: scripts.build ? 'npm run build' : 'npx next build',
      startCommand: scripts.start ? 'npm start' : 'npx next start',
      description: 'Aplikasi Next.js dengan SSR/SSG',
      port: 3000,
      envVars: { PORT: '${PORT}' }
    };
  }
  
  // Deteksi Vite
  if (dependencies['vite']) {
    return {
      type: PROJECT_TYPES.VITE,
      name: 'Vite',
      buildCommand: 'npm run build',
      startCommand: 'npm run preview',
      description: 'Aplikasi Vite (React/Vue/Svelte)',
      port: 4173,
      envVars: {}
    };
  }
  
  // Deteksi Express
  if (dependencies['express']) {
    const startScript = scripts.start || 'node index.js';
    return {
      type: PROJECT_TYPES.EXPRESS,
      name: 'Express API',
      buildCommand: scripts.build ? 'npm run build' : null,
      startCommand: `npm start`,
      description: 'API/Backend Express.js',
      port: 3000,
      envVars: { PORT: '${PORT}' }
    };
  }
  
  // Deteksi Bot (hanya ada script start, tanpa framework web)
  if (scripts.start && !dependencies['express'] && !dependencies['fastify'] && !dependencies['koa']) {
    return {
      type: PROJECT_TYPES.BOT,
      name: 'Node.js Bot/Script',
      buildCommand: scripts.build ? 'npm run build' : null,
      startCommand: 'npm start',
      description: 'Bot atau script Node.js',
      port: null,
      envVars: {}
    };
  }
  
  // Default untuk project Node.js lainnya
  return {
    type: PROJECT_TYPES.UNKNOWN,
    name: 'Node.js Project',
    buildCommand: scripts.build ? 'npm run build' : null,
    startCommand: scripts.start ? 'npm start' : 'node index.js',
    description: 'Project Node.js standar',
    port: 3000,
    envVars: { PORT: '${PORT}' }
  };
}

// Dapatkan info lengkap project
async function getProjectInfo(projectDir) {
  const projectType = await detectProjectType(projectDir);
  const packageJsonPath = path.join(projectDir, 'package.json');
  
  let packageInfo = {};
  if (await fs.pathExists(packageJsonPath)) {
    try {
      const pkg = await fs.readJson(packageJsonPath);
      packageInfo = {
        name: pkg.name || 'unnamed',
        version: pkg.version || '1.0.0',
        description: pkg.description || '',
        main: pkg.main || 'index.js'
      };
    } catch (error) {
      console.error('[Detector] Error:', error.message);
    }
  }
  
  return {
    ...projectType,
    package: packageInfo
  };
}

// Generate PM2 config berdasarkan tipe project
function generatePM2Config(appName, projectDir, port, projectType) {
  const config = {
    apps: [{
      name: appName,
      cwd: projectDir,
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: port
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: path.join(projectDir, 'logs', 'error.log'),
      out_file: path.join(projectDir, 'logs', 'out.log'),
      log_file: path.join(projectDir, 'logs', 'combined.log'),
      time: true
    }]
  };
  
  // Sesuaikan berdasarkan tipe project
  if (projectType.type === PROJECT_TYPES.NEXTJS) {
    config.apps[0].script = 'node_modules/.bin/next';
    config.apps[0].args = 'start';
    config.apps[0].env.PORT = port;
  }
  
  if (projectType.type === PROJECT_TYPES.BOT) {
    delete config.apps[0].env.PORT;
  }
  
  return config;
}

module.exports = {
  detectProjectType,
  getProjectInfo,
  generatePM2Config,
  PROJECT_TYPES
};
