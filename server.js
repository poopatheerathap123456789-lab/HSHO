const express = require('express');
const mongoose = require('mongoose');
const https = require('https');
const path = require('path');
const fs = require('fs');

try { require('module-alias/register'); } catch (e) {}

let config = {};
try { config = require('@config'); } catch (e) {}

const MONGO_URI = process.env.MONGO_URI || config?.mongo?.uri || 'mongodb://Phupha232:PhuphaTEE@ac-buskksu-shard-00-00.a15cvru.mongodb.net:27017,ac-buskksu-shard-00-01.a15cvru.mongodb.net:27017,ac-buskksu-shard-00-02.a15cvru.mongodb.net:27017/?ssl=true&replicaSet=atlas-3vpvc6-shard-0&authSource=admin&appName=Cluster0';
const DB_NAME = process.env.MONGO_DB_NAME || config?.mongo?.dbName || 'HSHO-PrivateServer';
const PORT = process.env.PORT || config?.port || 3000;

// หน่วยความจำแคชเก็บชื่อ Steam ตาม SteamID
const steamCache = {};
const ipToSteamName = {};

// ดึงชื่อโปรไฟล์ Steam จากเว็บ Steam โดยตรง (ไม่ต้องใช้ API Key)
function fetchSteamName(steamId) {
  return new Promise((resolve) => {
    if (!steamId || !/^\d{17}$/.test(String(steamId))) return resolve(null);
    if (steamCache[steamId]) return resolve(steamCache[steamId]);

    const req = https.get(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, { timeout: 5000 }, (res) => {
      let xml = '';
      res.on('data', chunk => xml += chunk);
      res.on('end', () => {
        const match = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/i) || xml.match(/<steamID>(.*?)<\/steamID>/i);
        if (match && match[1]) {
          const name = match[1].trim();
          steamCache[steamId] = name;
          return resolve(name);
        }
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ค้นหา SteamID64 จาก Payload ที่ตัวเกมส่งมา
function findSteamId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k in obj) {
    if (typeof obj[k] === 'string' || typeof obj[k] === 'number') {
      const val = String(obj[k]);
      if (/^\d{17}$/.test(val) && val !== '76561198999999999') return val;
    } else if (typeof obj[k] === 'object') {
      const found = findSteamId(obj[k]);
      if (found) return found;
    }
  }
  return null;
}

let routes, Health;
try { routes = require('@routes'); } catch (e) {
  routes = express.Router();
  routes.all('*', (req, res) => res.json({ status: 1, data: {} }));
}

try { Health = require('@src/Health'); } catch (e) {
  Health = express.Router();
  Health.get('/health', (req, res) => res.json({ status: 'OK' }));
}

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// ระบบตรวจจับชื่อ Steam จาก SteamID และดักจับ Response บังคับเปลี่ยนชื่อ
app.use(async (req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  let steamId = findSteamId(req.body) || findSteamId(req.query) || findSteamId(req.headers);
  
  let currentSteamName = null;
  if (steamId) {
    currentSteamName = await fetchSteamName(steamId);
    if (currentSteamName) {
      ipToSteamName[clientIp] = currentSteamName;
    }
  }

  if (!currentSteamName && ipToSteamName[clientIp]) {
    currentSteamName = ipToSteamName[clientIp];
  }

  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);

  const patchData = (data) => {
    if (!data) return data;
    const activeName = currentSteamName || Object.values(steamCache).pop() || null;
    if (!activeName) return data;

    try {
      if (typeof data === 'object' && !Buffer.isBuffer(data)) {
        let str = JSON.stringify(data);
        if (str.includes('Player_')) {
          str = str.replace(/Player_\d+/g, activeName);
          return JSON.parse(str);
        }
        return data;
      }
      if (typeof data === 'string' && data.includes('Player_')) {
        return data.replace(/Player_\d+/g, activeName);
      }
      if (Buffer.isBuffer(data)) {
        let str = data.toString('utf8');
        if (str.includes('Player_')) {
          str = str.replace(/Player_\d+/g, activeName);
          return Buffer.from(str, 'utf8');
        }
      }
    } catch (e) {}
    return data;
  };

  res.json = function(body) { return origJson(patchData(body)); };
  res.send = function(body) { return origSend(patchData(body)); };

  next();
});

app.use('/', routes);
app.use('/', Health);

app.use((req, res) => {
  res.status(200).json({ status: 1, data: { success: true }, error: null });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(200).json({ status: 1, data: { success: true }, error: null });
});

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log(`Connected to MongoDB: ${DB_NAME}`);
    
    // เคลียร์ชื่อค้างใน Database เมื่อเปิดเซิร์ฟเวอร์
    try {
      const db = mongoose.connection.db;
      const collections = await db.listCollections().toArray();
      for (let col of collections) {
        if (col.name.toLowerCase().includes('user') || col.name.toLowerCase().includes('account')) {
          const collection = db.collection(col.name);
          await collection.updateMany(
            { $or: [{ username: /Player_/ }, { displayName: /Player_/ }, { name: /Player_/ }] },
            { $unset: { username: "", displayName: "", name: "" } }
          );
        }
      }
    } catch (e) {}

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Auto Steam Fetcher Engine Active`);
    });
  } catch (err) {
    console.error('DB Error:', err.message);
    setTimeout(startServer, 5000);
  }
}

startServer();
