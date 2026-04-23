import type { AppConfig, DeploymentRecord } from './types.js';

export function buildCaddyfile(
  config: Pick<AppConfig, 'appPort' | 'publicHostSuffix' | 'publicPort' | 'rootHost'>,
  runningDeployments: DeploymentRecord[]
): string {
  const siteBlocks = [
    `{
  auto_https off
  admin 0.0.0.0:2019
}

http://${config.rootHost}:${config.publicPort} {
  encode zstd gzip

  handle /api/* {
    reverse_proxy api:3001
  }

  handle /healthz {
    reverse_proxy api:3001
  }

  handle {
    reverse_proxy web:4173
  }
}`
  ];

  for (const deployment of runningDeployments) {
    if (!deployment.containerName) {
      continue;
    }

    siteBlocks.push(`
http://${deployment.slug}.${config.publicHostSuffix}:${config.publicPort} {
  encode zstd gzip
  reverse_proxy ${deployment.containerName}:${config.appPort}
}`);
  }

  return siteBlocks.join('\n\n');
}

export async function loadCaddyConfig(
  adminBaseUrl: string,
  caddyfile: string
): Promise<void> {
  const response = await fetch(`${adminBaseUrl}/load`, {
    method: 'POST',
    headers: {
      'content-type': 'text/caddyfile'
    },
    body: caddyfile
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Caddy reload failed: ${response.status} ${body}`);
  }
}
