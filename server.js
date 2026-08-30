require('module-alias/register');
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const config = require('@config/index');
const routes = require('@routes/index');
const Health = require('@src/Health');

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.use('/', routes);
app.use('/', Health);

const MONGO_URI = process.env.MONGO_URI || config?.mongo?.uri || 'mongodb://Phupha232:PhuphaTEE@ac-buskksu-shard-00-00.a15cvru.mongodb.net:27017,ac-buskksu-shard-00-01.a15cvru.mongodb.net:27017,ac-buskksu-shard-00-02.a15cvru.mongodb.net:27017/?ssl=true&replicaSet=atlas-3vpvc6-shard-0&authSource=admin&appName=Cluster0';
const DB_NAME = config?.mongo?.dbName || 'HSHO-PrivateServer';
const PORT = config?.port || 3000;
const ENV = config?.env || 'development';

async function start() {
  try {
    await mongoose.connect(MONGO_URI, {
      dbName: DB_NAME,
    });
    console.log(`MongoDB connected to: ${DB_NAME}`);

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${ENV}`);
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
