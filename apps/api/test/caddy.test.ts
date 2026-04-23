import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCaddyfile } from '../src/caddy.js';
import type { DeploymentRecord } from '../src/types.js';

test('renders root routes and running deployment hosts', () => {
  const deployments: DeploymentRecord[] = [
    {
      id: 'dep-1',
      slug: 'hello-dep',
      sourceType: 'git',
      sourceLabel: 'https://github.com/example/hello',
      status: 'running',
      imageTag: 'brimble/hello:123',
      publicUrl: 'http://hello-dep.localhost:8080',
      containerName: 'brimble-dep-1',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
      startedAt: '2026-04-22T00:00:00.000Z',
      finishedAt: '2026-04-22T00:00:00.000Z',
      failureReason: null
    }
  ];

  const caddyfile = buildCaddyfile(
    {
      rootHost: 'localhost',
      publicHostSuffix: 'localhost',
      publicPort: 8080,
      appPort: 3000
    },
    deployments
  );

  assert.match(caddyfile, /http:\/\/localhost:8080/);
  assert.match(caddyfile, /handle \/api\/\*/);
  assert.match(caddyfile, /http:\/\/hello-dep\.localhost:8080/);
  assert.match(caddyfile, /reverse_proxy brimble-dep-1:3000/);
});

test('uses configured ports and host suffixes', () => {
  const caddyfile = buildCaddyfile(
    {
      rootHost: 'brimble.test',
      publicHostSuffix: 'brimble.test',
      publicPort: 9090,
      appPort: 4000
    },
    [
      {
        id: 'dep-2',
        slug: 'configured',
        sourceType: 'archive',
        sourceLabel: 'configured.zip',
        status: 'running',
        imageTag: 'brimble/configured:1',
        publicUrl: 'http://configured.brimble.test:9090',
        containerName: 'brimble-dep-2',
        createdAt: '2026-04-22T00:00:00.000Z',
        updatedAt: '2026-04-22T00:00:00.000Z',
        startedAt: '2026-04-22T00:00:00.000Z',
        finishedAt: '2026-04-22T00:00:00.000Z',
        failureReason: null
      }
    ]
  );

  assert.match(caddyfile, /http:\/\/brimble\.test:9090/);
  assert.match(caddyfile, /http:\/\/configured\.brimble\.test:9090/);
  assert.match(caddyfile, /reverse_proxy brimble-dep-2:4000/);
});
