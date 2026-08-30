const express = require('express');
const mongoose = require('mongoose');
const https = require('https');
const path = require('path');
const fs = require('fs');

try {
  require('module-alias/register');
} catch (e) {}

let config = {};
try {
  config = require('@config');
} catch (e) {}

// ระบบ Cache เก็บชื่อ Steam แต่ละคน เพื่อลดเวลาโหลด
const steamNameCache = {};

// ฟังก์ชันดึงชื่อโปรไฟล์ Steam จาก Steam ID โดยตรง (ไม่ต้องใช้ API Key)
function fetchSteamNameFromID(steamId) {
  return new Promise((resolve) => {
    if (!steamId || !/^\d{17}$/.test(steamId)) {
      return resolve(null);
    }
    
    // ถ้าเคยดึงชื่อคนนี้มาแล้ว ให้ใช้ชื่อจาก Cache
    if (steamNameCache[steamId]) {
      return resolve(steamNameCache[steamId]);
    }

    const url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const match = data.match(/<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/) || data.match(/<steamID>(.*?)<\/steamID>/);
          if (match && match[1]) {
            const name = match[1].trim();
            steamNameCache[steamId] = name;
            return resolve(name);
          }
        } catch (e) {}
        resolve(null);
      });
    }).on('error', () => resolve(null));
  });
}

// ฟังก์ชันแกะหา Steam ID จากข้อมูลที่เกมส่งมาใน Request
function extractSteamId(req) {
  const searchObj = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    for (let key in obj) {
      if (/steam.*id|user.*id/i.test(key)) {
        const val = String(obj[key]);
        if (/^\d{17}$/.test(val)) return val;
      }
      if (typeof obj[key] === 'object') {
        const res = searchObj(obj[key]);
        if (res) return res;
      }
    }
    return null;
  };

  return searchObj(req.body) || searchObj(req.query) || searchObj(req.headers);
}

const MONGO_URI = process.env.MONGO_URI || config?.mongo?.uri || 'mongodb://Phupha232:PhuphaTEE@ac-buskksu-shard-00-00.a15cvru.mongodb.net:27017,ac-buskksu-shard-00-01.a15cvru.mongodb.net:27017,ac-buskksu-shard-00-02.a15cvru.mongodb.net:27017/?ssl=true&replicaSet=atlas-3vpvc6-shard-0&authSource=admin&appName=Cluster0';
const DB_NAME = process.env.MONGO_DB_NAME || config?.mongo?.dbName || 'HSHO-PrivateServer';
const PORT = process.env.PORT || config?.port || 3000;

let routes, Health;
try {
  routes = require('@routes');
} catch (e) {
  routes = express.Router();
  routes.all('*', (req, res) => res.json({ status: 1, data: {} }));
}

try {
  Health = require('@src/Health');
} catch (e) {
  Health = express.Router();
  Health.get('/health', (req, res) => res.json({ status: 'OK' }));
}

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Middleware ดักจับข้อมูลแบบสแกนหาผู้เล่นคนนั้นๆ อัตโนมัติ
app.use(async (req, res, next) => {
  const playerSteamId = extractSteamId(req);
  let playerSteamName = null;

  if (playerSteamId) {
    playerSteamName = await fetchSteamNameFromID(playerSteamId);
  }

  const originalJson = res.json;
  const originalSend = res.send;

  const overrideData = (data) => {
    if (!data || !playerSteamName) return data;
    try {
      if (typeof data === 'object' && !Buffer.isBuffer(data)) {
        let str = JSON.stringify(data);
        if (str.includes('Player_')) {
          str = str.replace(/Player_\d+/g, playerSteamName);
          return JSON.parse(str);
        }
        return data;
      }
      if (typeof data === 'string' && data.includes('Player_')) {
        return data.replace(/Player_\d+/g, playerSteamName);
      }
      if (Buffer.isBuffer(data)) {
        let str = data.toString('utf8');
        if (str.includes('Player_')) {
          str = str.replace(/Player_\d+/g, playerSteamName);
          return Buffer.from(str, 'utf8');
        }
      }
    } catch (e) {}
    return data;
  };

  res.json = function(body) {
    return originalJson.call(this, overrideData(body));
  };

  res.send = function(body) {
    return originalSend.call(this, overrideData(body));
  };

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
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Auto Steam Profiler System Activated`);
    });
  } catch (err) {
    console.error('DB Error:', err.message);
    setTimeout(startServer, 5000);
  }
}

startServer();
