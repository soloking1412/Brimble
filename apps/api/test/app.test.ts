import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { EventBus } from '../src/event-bus.js';
import { Repository } from '../src/repository.js';
import type { AppConfig } from '../src/types.js';

function buildMultipart(parts: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>) {
  const boundary = 'brimble-boundary';
  const chunks: Buffer[] = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));

    if (part.filename) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
        )
      );
      chunks.push(
        Buffer.from(`Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`)
      );
      chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
      chunks.push(Buffer.from('\r\n'));
      continue;
    }

    chunks.push(
      Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`)
    );
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    boundary,
    body: Buffer.concat(chunks)
  };
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'brimble-api-test-'));
const sampleAppPath = path.join(tempDir, 'hello-node.zip');
await writeFile(sampleAppPath, Buffer.from('sample-zip'));

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createConfig(): AppConfig {
  return {
    port: 3001,
    dataDir: tempDir,
    rootHost: 'localhost',
    publicPort: 8080,
    publicHostSuffix: 'localhost',
    caddyAdminUrl: 'http://caddy:2019',
    dockerNetwork: 'brimble-network',
    appPort: 3000,
    railpackBin: 'railpack',
    sampleAppPath
  };
}

function createTestApp() {
  const repository = new Repository(':memory:');
  const app = buildApp({
    repository,
    eventBus: new EventBus(),
    worker: {
      enqueue: async () => undefined
    } as never,
    config: createConfig()
  });

  return { app, repository };
}

test('rejects requests that provide both gitUrl and archive', async () => {
  const { app, repository } = createTestApp();
  const payload = buildMultipart([
    { name: 'gitUrl', value: 'https://github.com/example/repo' },
    {
      name: 'archive',
      value: Buffer.from('hello'),
      filename: 'example.zip',
      contentType: 'application/zip'
    }
  ]);

  const response = await app.inject({
    method: 'POST',
    url: '/api/deployments',
    headers: {
      'content-type': `multipart/form-data; boundary=${payload.boundary}`
    },
    payload: payload.body
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /either a Git URL or a zip upload/i);
  await app.close();
  repository.close();
});

test('rejects requests that provide neither gitUrl nor archive', async () => {
  const { app, repository } = createTestApp();
  const payload = buildMultipart([]);

  const response = await app.inject({
    method: 'POST',
    url: '/api/deployments',
    headers: {
      'content-type': `multipart/form-data; boundary=${payload.boundary}`
    },
    payload: payload.body
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /provide a Git URL or upload a zip archive/i);
  await app.close();
  repository.close();
});

test('creates a pending deployment from a git url', async () => {
  const { app, repository } = createTestApp();
  const payload = buildMultipart([
    { name: 'gitUrl', value: 'https://github.com/example/repo' }
  ]);

  const response = await app.inject({
    method: 'POST',
    url: '/api/deployments',
    headers: {
      'content-type': `multipart/form-data; boundary=${payload.boundary}`
    },
    payload: payload.body
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.deployment.status, 'pending');
  assert.equal(body.deployment.sourceType, 'git');
  assert.match(body.deployment.slug, /^repo-/);
  assert.equal(repository.listDeployments().length, 1);

  await app.close();
  repository.close();
});

test('rejects unsupported git url protocols', async () => {
  const { app, repository } = createTestApp();
  const payload = buildMultipart([
    { name: 'gitUrl', value: 'file:///tmp/repo' }
  ]);

  const response = await app.inject({
    method: 'POST',
    url: '/api/deployments',
    headers: {
      'content-type': `multipart/form-data; boundary=${payload.boundary}`
    },
    payload: payload.body
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /http or https/i);
  await app.close();
  repository.close();
});

test('rejects redeploy when deployment has no image tag', async () => {
  const { app, repository } = createTestApp();
  const payload = buildMultipart([
    { name: 'gitUrl', value: 'https://github.com/example/repo' }
  ]);

  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/deployments',
    headers: { 'content-type': `multipart/form-data; boundary=${payload.boundary}` },
    payload: payload.body
  });

  const { deployment } = createResponse.json();

  const redeployResponse = await app.inject({
    method: 'POST',
    url: `/api/deployments/${deployment.id}/redeploy`
  });

  assert.equal(redeployResponse.statusCode, 422);
  assert.match(redeployResponse.json().error, /no image/i);

  await app.close();
  repository.close();
});

test('redeploy creates new deployment from existing image tag', async () => {
  const { app, repository } = createTestApp();
  const id = (await import('../src/helpers.js').then(m => m.makeId))();

  repository.createDeployment({
    id,
    slug: 'hello-' + id.slice(0, 8),
    sourceType: 'git',
    sourceLabel: 'https://github.com/example/hello'
  });

  repository.updateDeployment(id, {
    status: 'running',
    imageTag: 'brimble/hello:12345'
  });

  const response = await app.inject({
    method: 'POST',
    url: `/api/deployments/${id}/redeploy`
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.deployment.status, 'pending');
  assert.equal(body.deployment.sourceType, 'git');
  assert.equal(repository.listDeployments().length, 2);

  await app.close();
  repository.close();
});

test('serves the bundled sample app zip', async () => {
  const { app, repository } = createTestApp();

  const response = await app.inject({
    method: 'GET',
    url: '/api/sample-app'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.match(String(response.headers['content-disposition']), /hello-node\.zip/);
  assert.equal(response.body, 'sample-zip');

  await app.close();
  repository.close();
});
