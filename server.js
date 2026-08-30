const express = require('express');
const mongoose = require('mongoose');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

try {
  require('module-alias/register');
} catch (e) {}

let config = {};
try {
  config = require('@config');
} catch (e) {}

let cachedSteamName = null;

function fetchSteamUser() {
  if (cachedSteamName) return cachedSteamName;

  let name = null;

  try {
    const res = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v PersonaName 2>nul', { encoding: 'utf8' });
    const match = res.match(/PersonaName\s+REG_SZ\s+([^\r\n]+)/i);
    if (match && match[1]) name = match[1].trim();
  } catch (e) {}

  if (!name) {
    try {
      const res = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath 2>nul', { encoding: 'utf8' });
      const match = res.match(/SteamPath\s+REG_SZ\s+([^\r\n]+)/i);
      if (match && match[1]) {
        const vdf = path.join(match[1].trim(), 'config', 'loginusers.vdf');
        if (fs.existsSync(vdf)) {
          const content = fs.readFileSync(vdf, 'utf8');
          const nameMatch = content.match(/"PersonaName"\s+"([^"]+)"/);
          if (nameMatch) name = nameMatch[1];
        }
      }
    } catch (e) {}
  }

  if (!name) {
    try {
      const defaultPaths = [
        'C:\\Program Files (x86)\\Steam\\config\\loginusers.vdf',
        'C:\\Program Files\\Steam\\config\\loginusers.vdf'
      ];
      for (let p of defaultPaths) {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf8');
          const nameMatch = content.match(/"PersonaName"\s+"([^"]+)"/);
          if (nameMatch) { name = nameMatch[1]; break; }
        }
      }
    } catch (e) {}
  }

  cachedSteamName = name || "SteamUser"; // ลบระบบสุ่ม Player_xxxx ออกถาวร
  return cachedSteamName;
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

// ระบบดักจับและเขียนทับชื่อให้เป็นชื่อ Steam แบบบังคับ
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  const steamName = fetchSteamUser();

  res.json = function(body) {
    if (body) {
      // ใช้วิธีแปลงเป็นตัวหนังสือแล้วค้นหาคำว่า Player_ ตามด้วยตัวเลข เพื่อลบของเก่าทิ้ง
      let strBody = JSON.stringify(body);
      strBody = strBody.replace(/Player_\d+/g, steamName);
      
      try {
        body = JSON.parse(strBody);
      } catch(e) {}
      
      // บังคับแก้ชื่อตัวแปรหลักๆ ซ้ำอีกรอบกันเหนียว
      if (body.data && typeof body.data === 'object') {
        if (body.data.username) body.data.username = steamName;
        if (body.data.displayName) body.data.displayName = steamName;
        if (body.data.name) body.data.name = steamName;
        
        if (body.data.profile) {
          if (body.data.profile.username) body.data.profile.username = steamName;
          if (body.data.profile.displayName) body.data.profile.displayName = steamName;
        }
      }
    }
    return originalJson(body);
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
      console.log(`====> STEAM NAME LOADED: ${fetchSteamUser()} <====`);
    });
  } catch (err) {
    console.error('DB Error:', err.message);
    setTimeout(startServer, 5000);
  }
}

startServer();
