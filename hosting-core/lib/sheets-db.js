/**
 * Google Sheets Database Module
 * Mengelola semua operasi database menggunakan Google Sheets
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class SheetsDB {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = null;
    this.initialized = false;
    this.config = null;
  }

  loadConfig() {
    if (this.config) return this.config;
    
    const configPath = path.join(__dirname, '..', 'sheet.json');
    
    if (fs.existsSync(configPath)) {
      try {
        const configData = fs.readFileSync(configPath, 'utf8');
        this.config = JSON.parse(configData);
        console.log('[SheetsDB] Config loaded from sheet.json');
        return this.config;
      } catch (error) {
        console.error('[SheetsDB] Error reading sheet.json:', error.message);
      }
    }
    
    this.config = {
      GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY || '',
      GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL || '',
      GOOGLE_PRIVATE_KEY_ID: process.env.GOOGLE_PRIVATE_KEY_ID || '',
      GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID || '',
      GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || ''
    };
    
    return this.config;
  }

  async init() {
    if (this.initialized) return;

    try {
      const config = this.loadConfig();
      
      this.spreadsheetId = config.GOOGLE_SHEET_ID;
      
      if (!this.spreadsheetId) {
        throw new Error('GOOGLE_SHEET_ID is required');
      }
      
      let privateKey = config.GOOGLE_PRIVATE_KEY || '';
      
      try {
        if (privateKey.startsWith('"') || privateKey.startsWith("'")) {
          privateKey = JSON.parse(privateKey);
        }
      } catch (e) {}
      
      privateKey = privateKey
        .replace(/\\\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n');
      
      if (!privateKey.includes('\n')) {
        const beginMarker = '-----BEGIN PRIVATE KEY-----';
        const endMarker = '-----END PRIVATE KEY-----';
        
        if (privateKey.includes(beginMarker) && privateKey.includes(endMarker)) {
          const keyContent = privateKey
            .replace(beginMarker, '')
            .replace(endMarker, '')
            .replace(/\s/g, '');
          
          const formattedKey = keyContent.match(/.{1,64}/g).join('\n');
          privateKey = `${beginMarker}\n${formattedKey}\n${endMarker}`;
          console.log('[SheetsDB] Reformatted private key with proper newlines');
        }
      }
      
      if (!privateKey.includes('-----BEGIN')) {
        console.error('[SheetsDB] Invalid private key format - missing BEGIN marker');
        console.error('[SheetsDB] Key starts with:', privateKey.substring(0, 50));
        throw new Error('Invalid private key format');
      }

      const auth = new google.auth.GoogleAuth({
        credentials: {
          type: 'service_account',
          client_email: config.GOOGLE_CLIENT_EMAIL,
          private_key: privateKey,
          private_key_id: config.GOOGLE_PRIVATE_KEY_ID,
          project_id: config.GOOGLE_PROJECT_ID
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const client = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: client });
      
      await this.setupSheets();
      this.initialized = true;
      console.log('[SheetsDB] Database initialized successfully');
    } catch (error) {
      console.error('[SheetsDB] Init error:', error.message);
      throw error;
    }
  }

  async setupSheets() {
    const requiredSheets = [
      { name: 'Users', headers: ['id', 'username', 'email', 'password', 'tier', 'created_at', 'last_login', 'is_admin', 'status', 'avatar'] },
      { name: 'Sessions', headers: ['id', 'user_id', 'token', 'created_at', 'expires_at', 'ip_address', 'user_agent'] },
      { name: 'Apps', headers: ['id', 'user_id', 'name', 'type', 'status', 'port', 'created_at', 'last_deploy', 'domain', 'config'] },
      { name: 'Logs', headers: ['id', 'user_id', 'app_id', 'type', 'message', 'created_at', 'level'] },
      { name: 'Settings', headers: ['key', 'value', 'description', 'updated_at'] },
      { name: 'Analytics', headers: ['id', 'user_id', 'app_id', 'event', 'data', 'created_at', 'ip_address'] }
    ];

    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

      for (const sheet of requiredSheets) {
        if (!existingSheets.includes(sheet.name)) {
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [{
                addSheet: {
                  properties: { title: sheet.name }
                }
              }]
            }
          });

          await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${sheet.name}!A1`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [sheet.headers]
            }
          });

          console.log(`[SheetsDB] Created sheet: ${sheet.name}`);
        }
      }

      await this.initDefaultSettings();
    } catch (error) {
      console.error('[SheetsDB] Setup error:', error.message);
      throw error;
    }
  }

  async initDefaultSettings() {
    const defaultSettings = [
      { key: 'site_name', value: 'Hosting Mandiri', description: 'Nama website' },
      { key: 'max_apps_free', value: '3', description: 'Maksimal aplikasi untuk user free' },
      { key: 'max_apps_vip', value: '20', description: 'Maksimal aplikasi untuk user VIP' },
      { key: 'max_storage_free', value: '100', description: 'Maksimal storage (MB) untuk user free' },
      { key: 'max_storage_vip', value: '1000', description: 'Maksimal storage (MB) untuk user VIP' },
      { key: 'allow_registration', value: 'true', description: 'Izinkan registrasi baru' },
      { key: 'maintenance_mode', value: 'false', description: 'Mode maintenance' },
      { key: 'terminal_enabled', value: 'true', description: 'Aktifkan terminal' }
    ];

    const existing = await this.getAll('Settings');
    if (existing.length === 0) {
      for (const setting of defaultSettings) {
        await this.insert('Settings', {
          key: setting.key,
          value: setting.value,
          description: setting.description,
          updated_at: new Date().toISOString()
        });
      }
      console.log('[SheetsDB] Default settings created');
    }
  }

  async getHeaders(sheetName) {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!1:1`
    });
    return response.data.values ? response.data.values[0] : [];
  }

  async getAll(sheetName) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) return [];

      const headers = rows[0];
      return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, i) => {
          obj[header] = row[i] || '';
        });
        return obj;
      });
    } catch (error) {
      console.error(`[SheetsDB] getAll ${sheetName} error:`, error.message);
      return [];
    }
  }

  async findOne(sheetName, query) {
    const all = await this.getAll(sheetName);
    return all.find(row => {
      return Object.keys(query).every(key => row[key] === query[key]);
    });
  }

  async findMany(sheetName, query) {
    const all = await this.getAll(sheetName);
    return all.filter(row => {
      return Object.keys(query).every(key => row[key] === query[key]);
    });
  }

  async insert(sheetName, data) {
    try {
      const headers = await this.getHeaders(sheetName);
      const row = headers.map(h => data[h] || '');

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [row]
        }
      });

      return data;
    } catch (error) {
      console.error(`[SheetsDB] insert ${sheetName} error:`, error.message);
      throw error;
    }
  }

  async update(sheetName, query, data) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) return null;

      const headers = rows[0];
      let rowIndex = -1;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const matches = Object.keys(query).every(key => {
          const colIndex = headers.indexOf(key);
          return colIndex !== -1 && row[colIndex] === query[key];
        });
        if (matches) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex === -1) return null;

      const updatedRow = [...rows[rowIndex]];
      Object.keys(data).forEach(key => {
        const colIndex = headers.indexOf(key);
        if (colIndex !== -1) {
          updatedRow[colIndex] = data[key];
        }
      });

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A${rowIndex + 1}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [updatedRow]
        }
      });

      const result = {};
      headers.forEach((h, i) => {
        result[h] = updatedRow[i] || '';
      });
      return result;
    } catch (error) {
      console.error(`[SheetsDB] update ${sheetName} error:`, error.message);
      throw error;
    }
  }

  async delete(sheetName, query) {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
      if (!sheet) return false;

      const sheetId = sheet.properties.sheetId;

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) return false;

      const headers = rows[0];
      let rowIndex = -1;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const matches = Object.keys(query).every(key => {
          const colIndex = headers.indexOf(key);
          return colIndex !== -1 && row[colIndex] === query[key];
        });
        if (matches) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex === -1) return false;

      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1
              }
            }
          }]
        }
      });

      return true;
    } catch (error) {
      console.error(`[SheetsDB] delete ${sheetName} error:`, error.message);
      throw error;
    }
  }

  async count(sheetName, query = null) {
    const all = query ? await this.findMany(sheetName, query) : await this.getAll(sheetName);
    return all.length;
  }

  async getSetting(key) {
    const setting = await this.findOne('Settings', { key });
    return setting ? setting.value : null;
  }

  async setSetting(key, value, description = '') {
    const existing = await this.findOne('Settings', { key });
    if (existing) {
      return await this.update('Settings', { key }, { value, updated_at: new Date().toISOString() });
    } else {
      return await this.insert('Settings', { key, value, description, updated_at: new Date().toISOString() });
    }
  }
}

module.exports = new SheetsDB();
