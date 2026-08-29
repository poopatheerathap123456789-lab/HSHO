 
'use strict';
 
require('module-alias/register');
require('dotenv').config();
 
const express = require('express');
const mongoose = require('mongoose');
const config = require('@config');
const routes = require('@routes');
const Health = require('@src/Health');
 
const app = express();
 
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
 
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
    await mongoose.connect(config.mongo.uri, {
      dbName: config.mongo.dbName
    });
 
    console.log(`[DB] Connected to: ${config.mongo.dbName}`);
 
    server = app.listen(config.port, () => {
      console.log(`[Server] Running on port ${config.port}`);
      console.log(`[Server] Environment: ${config.env}`);
    });
  } catch (err) {
    console.error('[Startup] Fatal error:', err.message);
    process.exit(1);
  }
}
 
async function shutdown(signal) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
 
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
 
    await mongoose.connection.close();
 
    console.log('[Server] Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during shutdown:', err.message);
    process.exit(1);
  }
}
 
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
 
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
  shutdown('uncaughtException');
});
 
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
  shutdown('unhandledRejection');
});
 
start();
