require('module-alias/register');
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const config = require('@config/index');
const routes = require('@routes/index');
const Health = require('@src/Health');

const app = express();

// บังคับให้ดึงเลขพอร์ตจากระบบ Render ก่อน (ซึ่งก็คือ 8888 ในกรณีนี้)
// ถ้าไม่มีค่อยรัน 3000 สำรองไว้ตอนเทสในคอมตัวเอง
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.use('/', routes);
app.use('/', Health);

// เพิ่มไว้เหนือ app.use('/', routes); ในไฟล์ server.js
app.use((req, res, next) => {
    console.log(`🎮 [DEBUG] เกมกำลังถามหา: ${req.method} ${req.url}`);
    next();
});

async function start() {
  try {
    await mongoose.mongoose.connect(config.mongo.uri, {
      dbName: config.mongo.dbName,
    });
    console.log(`MongoDB connected to: ${config.mongo.dbName}`);

    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port}`);
      console.log(`Environment: ${config.env}`);
    });
  } catch (err) {
    console.error('Startup error:', err.message);
    process.exit(1);
  }
}

async function shutdown() {
  try {
    await mongoose.connection.close();
    console.log('Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
