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

function fetchSteamUser() {
  try {
    const res = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v PersonaName 2>nul', { 
      encoding: 'utf8', 
      windowsHide: true, 
      stdio: ['pipe', 'pipe', 'ignore'] 
    });
    const match = res.match(/PersonaName\s+REG_SZ\s+(.+)/i);
    if (match && match[1] && match[1].trim()) {
      return match[1].trim();
    }
  } catch (e) {}

  try {
    const res = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath 2>nul', { 
      encoding: 'utf8', 
      windowsHide: true, 
      stdio: ['pipe', 'pipe', 'ignore'] 
    });
    const match = res.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match && match[1]) {
      const vdf = path.join(match[1].trim(), 'config', 'loginusers.vdf');
      if (fs.existsSync(vdf)) {
        const content = fs.readFileSync(vdf, 'utf8');
        const matches = [...content.matchAll(/"PersonaName"\s+"([^"]+)"/g)];
        if (matches.length > 0) {
          return matches[matches.length - 1][1];
        }
      }
    }
  } catch (e) {}

  return "SteamPlayer";
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

app.use((req, res, next) => {
  req.steamUsername = fetchSteamUser();
  next();
});

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  
  res.json = function(body) {
    const steamName = req.steamUsername || fetchSteamUser();

    if (!body) {
      body = { status: 1, success: true, data: {}, error: null };
    }

    if (typeof body === 'object') {
      if (!body.data) body.data = {};

      if (typeof body.data === 'object') {
        body.data.username = steamName;
        body.data.displayName = steamName;
        body.data.nickname = steamName;
        body.data.personaName = steamName;
        body.data.name = steamName;

        if (body.data.user && typeof body.data.user === 'object') {
          body.data.user.username = steamName;
          body.data.user.displayName = steamName;
          body.data.user.nickname = steamName;
          body.data.user.name = steamName;
        }
        if (body.data.profile && typeof body.data.profile === 'object') {
          body.data.profile.username = steamName;
          body.data.profile.displayName = steamName;
          body.data.profile.nickname = steamName;
          body.data.profile.name = steamName;
        }
      }

      body.status = 1;
      if (body.error !== undefined) body.error = null;
    }

    return originalJson(body);
  };
  
  next();
});

app.use('/', routes);
app.use('/', Health);

app.use((req, res) => {
  res.status(200).json({
    status: 1,
    data: { success: true },
    error: null
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(200).json({
    status: 1,
    data: { success: true },
    error: null
  });
});

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log(`Connected to MongoDB: ${DB_NAME}`);
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Steam User: ${fetchSteamUser()}`);
    });
  } catch (err) {
    console.error('DB Error:', err.message);
    setTimeout(startServer, 5000);
  }
}

startServer();
