/**
 * MongoDB connection. Development without MONGODB_URI starts a local in-memory MongoDB
 * (mongodb-memory-server) whose data is kept in `.data/mongo`, so the API runs with no
 * account and no install. Production always uses MONGODB_URI (Atlas).
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import type { Config } from './config.js';

export interface Database {
  uri: string;
  stop(): Promise<void>;
}

export async function connectDatabase(config: Config, log = console.log): Promise<Database> {
  let uri = config.mongoUri;
  let stopServer: () => Promise<unknown> = async () => {};
  if (!uri) {
    if (config.isProduction) throw new Error('MONGODB_URI is required in production');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const dbPath = resolve('.data/mongo');
    mkdirSync(dbPath, { recursive: true });
    const server = await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: 'wiredTiger' },
    });
    uri = server.getUri('cleanify');
    stopServer = () => server.stop({ doCleanup: false });
    log(`[db] MONGODB_URI not set: using a local MongoDB with data in ${dbPath}`);
  }
  await mongoose.connect(uri);
  await mongoose.connection.syncIndexes();
  return {
    uri,
    async stop() {
      await mongoose.disconnect();
      await stopServer();
    },
  };
}
