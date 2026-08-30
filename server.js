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

  cachedSteamName = name || "SteamUser";
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

// ระบบดักจับขั้นเด็ดขาด ดักจับทุกช่องทางการส่งข้อมูลกลับไปหาเกม
app.use((req, res, next) => {
  const originalJson = res.json;
  const originalSend = res.send;
  const steamName = fetchSteamUser();

  const overrideData = (data) => {
    if (!data) return data;
    try {
      // ดักกรณีข้อมูลเป็น Object
      if (typeof data === 'object' && !Buffer.isBuffer(data)) {
        let str = JSON.stringify(data);
        if (str.includes('Player_')) {
          str = str.replace(/Player_\d+/g, steamName);
          return JSON.parse(str);
        }
        return data;
      }
      // ดักกรณีข้อมูลส่งมาเป็น Text/String
      if (typeof data === 'string' && data.includes('Player_')) {
        return data.replace(/Player_\d+/g, steamName);
      }
      // ดักกรณีข้อมูลส่งมาเป็น Buffer
      if (Buffer.isBuffer(data)) {
        let str = data.toString('utf8');
        if (str.includes('Player_')) {
          str = str.replace(/Player_\d+/g, steamName);
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
      console.log(`====> STEAM NAME ACTIVATED: ${fetchSteamUser()} <====`);
    });
  } catch (err) {
    console.error('DB Error:', err.message);
    setTimeout(startServer, 5000);
  }
}

startServer();
