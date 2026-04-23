import fs from 'node:fs/promises';
import { buildApp } from './app.js';
import { loadConfig, dbPath } from './config.js';
import { EventBus } from './event-bus.js';
import { Repository } from './repository.js';
import { DeploymentWorker } from './worker.js';

const config = loadConfig();
await fs.mkdir(config.dataDir, { recursive: true });

const repository = new Repository(dbPath(config));
const eventBus = new EventBus();
const worker = new DeploymentWorker(repository, eventBus, config);

await worker.recover();

const app = buildApp({
  repository,
  eventBus,
  worker,
  config
});

const close = async (): Promise<void> => {
  await app.close();
  repository.close();
};

process.on('SIGINT', () => {
  void close().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void close().finally(() => process.exit(0));
});

await app.listen({
  host: '0.0.0.0',
  port: config.port
});

void (async () => {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      await worker.syncCaddy();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
})();
