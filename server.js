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

let cachedUser = null;

function fetchSteamUser() {
  if (cachedUser) return cachedUser;
  
  try {
    const res = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v PersonaName 2>nul', { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const match = res.match(/PersonaName\s+REG_SZ\s+(.+)/i);
    if (match && match[1]) {
      cachedUser = match[1].trim();
      return cachedUser;
    }
  } catch (e) {}

  try {
    const res = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath 2>nul', { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const match = res.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match && match[1]) {
      const vdf = path.join(match[1].trim(), 'config', 'loginusers.vdf');
      if (fs.existsSync(vdf)) {
        const content = fs.readFileSync(vdf, 'utf8');
        const matches = [...content.matchAll(/"PersonaName"\s+"([^"]+)"/g)];
        if (matches.length > 0) {
          cachedUser = matches[matches.length - 1][1];
          return cachedUser;
        }
      }
    }
  } catch (e) {}

  cachedUser = `Player_${Math.floor(1000 + Math.random() * 9000)}`;
  return cachedUser;
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
  const pathLower = req.path.toLowerCase();
  if (pathLower.includes('steam') || pathLower.includes('auth') || pathLower.includes('login') || pathLower.includes('session') || pathLower.includes('user')) {
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (!body || body.status === 0 || body.error) {
        return originalJson({
          status: 1,
          success: true,
          data: {
            username: req.steamUsername,
            steamId: "76561198999999999",
            token: "valid_session_token",
            matched: true
          },
          error: null
        });
      }
      return originalJson(body);
    };
  }
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
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Database connection failed:', err.message);
    setTimeout(startServer, 5000);
  }
}

startServer();
