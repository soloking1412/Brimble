import path from 'node:path';
import type { AppConfig } from './types.js';

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR || '/data';
  const cwd = process.cwd();

  return {
    port: readNumber(process.env.PORT, 3001),
    dataDir,
    rootHost: process.env.ROOT_HOST || 'localhost',
    publicPort: readNumber(process.env.PUBLIC_PORT, 8080),
    publicHostSuffix: process.env.PUBLIC_HOST_SUFFIX || 'localhost',
    caddyAdminUrl: process.env.CADDY_ADMIN_URL || 'http://caddy:2019',
    dockerNetwork: process.env.DOCKER_NETWORK || 'brimble-network',
    appPort: readNumber(process.env.DEPLOYMENT_APP_PORT, 3000),
    railpackBin: process.env.RAILPACK_BIN || 'railpack',
    sampleAppPath:
      process.env.SAMPLE_APP_PATH ||
      path.join(cwd, 'examples', 'hello-node.zip')
  };
}

export function dbPath(config: AppConfig): string {
  return path.join(config.dataDir, 'brimble.sqlite');
}
