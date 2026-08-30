'use strict';

require('module-alias/register');
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// โหลด config และตั้งค่า Fallback เพื่อป้องกัน Server ค้าง/พังหากขาดค่าใน config
let config = {};
try {
  config = require('@config');
} catch (e) {
  config = {};
}

// 🟢 ฟังก์ชันดึงชื่อจาก Steam (ดึงจาก Registry -> ไฟล์ loginusers.vdf -> AutoLoginUser)
function getSteamUsername() {
  // 1. ลองดึงจาก Registry PersonaName (ซ่อน stderr ไม่ให้แสดงข้อความ error)
  try {
    const stdout = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v PersonaName 2>nul', { 
      encoding: 'utf8', 
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const match = stdout.match(/PersonaName\s+REG_SZ\s+(.+)/i);
    if (match && match[1] && match[1].trim()) {
      return match[1].trim();
    }
  } catch (e) {}

  // 2. ถ้าใน Registry ไม่มี ให้หา path โฟลเดอร์ Steam แล้วอ่านจาก loginusers.vdf
  try {
    const stdoutPath = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath 2>nul', { 
      encoding: 'utf8', 
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const matchPath = stdoutPath.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (matchPath && matchPath[1]) {
      const steamPath = matchPath[1].trim();
      const vdfPath = path.join(steamPath, 'config', 'loginusers.vdf');
      
      if (fs.existsSync(vdfPath)) {
        const vdfContent = fs.readFileSync(vdfPath, 'utf8');
        const personaMatches = [...vdfContent.matchAll(/"PersonaName"\s+"([^"]+)"/g)];
        if (personaMatches.length > 0) {
          return personaMatches[personaMatches.length - 1][1];
        }
      }
    }
  } catch (e) {}

  // 3. ดึงจาก AutoLoginUser
  try {
    const stdoutUser = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v AutoLoginUser 2>nul', { 
      encoding: 'utf8', 
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const matchUser = stdoutUser.match(/AutoLoginUser\s+REG_SZ\s+(.+)/i);
    if (matchUser && matchUser[1] && matchUser[1].trim()) {
      return matchUser[1].trim();
    }
  } catch (e) {}

  return `player_${Math.floor(1000 + Math.random() * 9000)}`;
}

// กำหนด MongoDB URI, DB Name, Port และ Environment
const MONGO_URI = process.env.MONGO_URI || config?.mongo?.uri || 'mongodb://Phupha232:PhuphaTEE@ac-buskksu-shard-00-00.a15cvru.mongodb.net:27017,ac-buskksu-shard-00-01.a15cvru.mongodb.net:27017,ac-buskksu-shard-00-02.a15cvru.mongodb.net:27017/?ssl=true&replicaSet=atlas-3vpvc6-shard-0&authSource=admin&appName=Cluster0';
const DB_NAME = process.env.MONGO_DB_NAME || config?.mongo?.dbName || 'HSHO-PrivateServer';
const PORT = process.env.PORT || config?.port || 3000;
const ENV = process.env.NODE_ENV || config?.env || 'development';

const routes = require('@routes');
const Health = require('@src/Health');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// 🟢 Middleware แนบชื่อ Steam เข้าไปใน req.steamUsername
app.use((req, _res, next) => {
  req.steamUsername = getSteamUsername();
  next();
});

app.use('/', routes);
app.use('/', Health);

app.use((_req, res) => {
  res.status(404).json({
    status: 0,
    data: null,
    error: 'Not found'
  });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);

  res.status(500).json({
    status: 0,
    data: null,
    error: 'Internal server error'
  });
});

let server;

async function start() {
  try {
    console.log('[DB] Connecting to MongoDB...');
    
    await mongoose.connect(MONGO_URI, {
      dbName: DB_NAME
    });

    console.log(`[DB] Connected successfully to: ${DB_NAME}`);
    console.log(`[Steam] Active Steam Profile: ${getSteamUsername()}`);

    server = app.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
      console.log(`[Server] Environment: ${ENV}`);
    });
  } catch (err) {
    console.error('[Startup] Fatal error during database or server initialization:', err.message);
    process.exit(1);
  }
}

async function shutdown(signal, exitCode = 0) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }

    console.log('[Server] Shutdown complete');
    process.exit(exitCode);
  } catch (err) {
    console.error('[Server] Error during shutdown:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
  shutdown('unhandledRejection', 1);
});

start();
