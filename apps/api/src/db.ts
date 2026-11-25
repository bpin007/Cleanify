/**
 * MongoDB connection. Development without MONGODB_URI starts a local in-memory MongoDB
 * (mongodb-memory-server) whose data is kept in `.data/mongo`, so the API runs with no
 * account and no install. With NODE_ENV=test the database is in memory only and gone
 * when the API stops. Production always uses MONGODB_URI (Atlas).
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
    // TEMPORARY: 60 s only because the repo sits in a OneDrive folder, where mongod is
    // slow to open its files. Set back to the 10 s default once the repo has moved out
    // of OneDrive (C:\dev\cleanify).
    const launchTimeout = 60_000;
    if (config.env === 'test') {
      // The cloud end-to-end suite (NODE_ENV=test): a throwaway database per run.
      const server = await MongoMemoryServer.create({ instance: { launchTimeout } });
      uri = server.getUri('cleanify');
      stopServer = () => server.stop();
      log('[db] NODE_ENV=test: using a throwaway in-memory MongoDB');
    } else {
      const dbPath = resolve('.data/mongo');
      mkdirSync(dbPath, { recursive: true });
      const server = await MongoMemoryServer.create({
        instance: { dbPath, storageEngine: 'wiredTiger', launchTimeout },
      });
      uri = server.getUri('cleanify');
      stopServer = () => server.stop({ doCleanup: false });
      log(`[db] MONGODB_URI not set: using a local MongoDB with data in ${dbPath}`);
    }
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
