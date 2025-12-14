/**
 * Port Manager - Mengelola alokasi port untuk setiap aplikasi
 * Sistem mencari port kosong otomatis dan menyimpannya ke ports.json
 */

const fs = require('fs-extra');
const path = require('path');
const net = require('net');

const PORTS_FILE = path.join(__dirname, 'data', 'ports.json');

// Baca data ports dari file
async function getPortsData() {
  try {
    await fs.ensureFile(PORTS_FILE);
    const data = await fs.readJson(PORTS_FILE);
    return data;
  } catch (error) {
    // Default jika file kosong atau error
    const defaultData = {
      usedPorts: [],
      portRange: { min: 3001, max: 4000 }
    };
    await fs.writeJson(PORTS_FILE, defaultData, { spaces: 2 });
    return defaultData;
  }
}

// Simpan data ports ke file
async function savePortsData(data) {
  await fs.writeJson(PORTS_FILE, data, { spaces: 2 });
}

// Cek apakah port sedang digunakan
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

// Cari port kosong yang tersedia
async function findAvailablePort() {
  const portsData = await getPortsData();
  const { usedPorts, portRange } = portsData;
  
  for (let port = portRange.min; port <= portRange.max; port++) {
    // Skip jika port sudah terdaftar digunakan
    if (usedPorts.includes(port)) continue;
    
    // Cek apakah port benar-benar kosong
    const inUse = await isPortInUse(port);
    if (!inUse) {
      return port;
    }
  }
  
  throw new Error('Tidak ada port tersedia dalam range yang ditentukan');
}

// Alokasikan port untuk aplikasi baru
async function allocatePort(appName) {
  const portsData = await getPortsData();
  const port = await findAvailablePort();
  
  portsData.usedPorts.push(port);
  await savePortsData(portsData);
  
  console.log(`[Port Manager] Port ${port} dialokasikan untuk ${appName}`);
  return port;
}

// Lepaskan port yang tidak digunakan lagi
async function releasePort(port) {
  const portsData = await getPortsData();
  const index = portsData.usedPorts.indexOf(port);
  
  if (index > -1) {
    portsData.usedPorts.splice(index, 1);
    await savePortsData(portsData);
    console.log(`[Port Manager] Port ${port} dilepaskan`);
  }
}

// Dapatkan semua port yang sedang digunakan
async function getUsedPorts() {
  const portsData = await getPortsData();
  return portsData.usedPorts;
}

module.exports = {
  findAvailablePort,
  allocatePort,
  releasePort,
  getUsedPorts,
  isPortInUse
};
