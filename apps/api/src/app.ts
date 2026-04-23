import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { EventBus } from './event-bus.js';
import {
  deriveSlug,
  makeId,
  sanitizeUploadName,
  sourceNameFromGitUrl,
  sseEvent
} from './helpers.js';
import { badRequest } from './errors.js';
import { Repository } from './repository.js';
import type { AppConfig, DeploymentJobSource } from './types.js';
import type { DeploymentWorker } from './worker.js';

interface AppServices {
  repository: Repository;
  eventBus: EventBus;
  worker: DeploymentWorker;
  config: AppConfig;
}

async function writeArchive(
  dataDir: string,
  deploymentId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const uploadsDir = path.join(dataDir, 'uploads');
  await fsp.mkdir(uploadsDir, { recursive: true });
  const target = path.join(uploadsDir, `${deploymentId}-${filename}`);
  await fsp.writeFile(target, buffer);
  return target;
}

function sendSseHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  reply.raw.flushHeaders();
}

function parseGitUrl(gitUrl: string): string {
  const parsed = z.string().url().safeParse(gitUrl);
  if (!parsed.success) {
    throw badRequest('Enter a valid Git URL.');
  }
  const protocol = new URL(parsed.data).protocol;

  if (protocol !== 'http:' && protocol !== 'https:') {
    throw badRequest('Git URLs must use http or https.');
  }

  return parsed.data;
}

async function parseCreateDeployment(
  request: FastifyRequest,
  config: AppConfig
): Promise<{
  deploymentId: string;
  sourceLabel: string;
  sourceType: 'git' | 'archive';
  source: DeploymentJobSource;
}> {
  const deploymentId = makeId();
  let gitUrl: string | undefined;
  let archiveBuffer: Buffer | undefined;
  let archiveName = 'upload.zip';

  const parts = request.parts();

  for await (const part of parts) {
    if (part.type === 'file') {
      archiveName = sanitizeUploadName(part.filename || archiveName);
      archiveBuffer = await part.toBuffer();
      continue;
    }

    if (part.fieldname === 'gitUrl') {
      gitUrl = String(part.value).trim();
    }
  }

  if (gitUrl && archiveBuffer) {
    throw badRequest('Provide either a Git URL or a zip upload, not both.');
  }

  if (!gitUrl && !archiveBuffer) {
    throw badRequest('Provide a Git URL or upload a zip archive.');
  }

  if (gitUrl) {
    const parsed = parseGitUrl(gitUrl);
    return {
      deploymentId,
      sourceLabel: parsed,
      sourceType: 'git',
      source: {
        type: 'git',
        gitUrl: parsed
      }
    };
  }

  const normalizedName = archiveName.toLowerCase();
  if (!normalizedName.endsWith('.zip')) {
    throw badRequest('Uploads must be .zip files.');
  }

  const archivePath = await writeArchive(config.dataDir, deploymentId, archiveName, archiveBuffer!);

  return {
    deploymentId,
    sourceLabel: archiveName,
    sourceType: 'archive',
    source: {
      type: 'archive',
      archivePath,
      originalName: archiveName
    }
  };
}

export function buildApp(services: AppServices) {
  const app = Fastify({
    logger: true
  });

  app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 1
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      reply.code(400).send({ error: 'Invalid request.' });
      return;
    }

    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      const statusCode =
        typeof error.statusCode === 'number' ? error.statusCode : 400;
      reply.code(statusCode);
      reply.send({
        error: error instanceof Error ? error.message : 'Request failed'
      });
      return;
    }

    request.log.error(error);
    reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/healthz', async () => ({
    ok: true
  }));

  app.get('/api/deployments', async () => ({
    deployments: services.repository.listDeployments()
  }));

  app.get('/api/deployments/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const deployment = services.repository.getDeployment(params.id);

    if (!deployment) {
      reply.code(404);
      return { error: 'Deployment not found' };
    }

    return {
      deployment,
      logs: services.repository.listLogs(params.id)
    };
  });

  app.get('/api/sample-app', async (_request, reply) => {
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', 'attachment; filename="hello-node.zip"');
    return reply.send(fs.createReadStream(services.config.sampleAppPath));
  });

  app.post('/api/deployments', async (request, reply) => {
    const parsed = await parseCreateDeployment(request, services.config);
    const slugBase =
      parsed.sourceType === 'git'
        ? sourceNameFromGitUrl(parsed.sourceLabel)
        : parsed.sourceLabel.replace(/\.zip$/i, '');
    const deployment = services.repository.createDeployment({
      id: parsed.deploymentId,
      slug: deriveSlug(slugBase, parsed.deploymentId),
      sourceType: parsed.sourceType,
      sourceLabel: parsed.sourceLabel
    });

    const initialLog = services.repository.appendLog(
      deployment.id,
      'system',
      'Deployment queued'
    );

    services.eventBus.publishLog(initialLog);
    services.eventBus.publishDeployment(deployment);
    await services.worker.enqueue({
      deploymentId: deployment.id,
      source: parsed.source
    });

    reply.code(201);
    return { deployment };
  });

  app.post('/api/deployments/:id/redeploy', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const source = services.repository.getDeployment(id);

    if (!source) {
      reply.code(404);
      return { error: 'Deployment not found' };
    }

    if (!source.imageTag) {
      reply.code(422);
      return { error: 'Deployment has no image to redeploy from.' };
    }

    const deploymentId = makeId();
    const slugBase =
      source.sourceType === 'git'
        ? sourceNameFromGitUrl(source.sourceLabel)
        : source.sourceLabel.replace(/\.zip$/i, '');

    const deployment = services.repository.createDeployment({
      id: deploymentId,
      slug: deriveSlug(slugBase, deploymentId),
      sourceType: source.sourceType,
      sourceLabel: source.sourceLabel
    });

    const initialLog = services.repository.appendLog(
      deployment.id,
      'system',
      `Redeploying image ${source.imageTag}`
    );

    services.eventBus.publishLog(initialLog);
    services.eventBus.publishDeployment(deployment);
    await services.worker.enqueue({
      deploymentId: deployment.id,
      source: { type: 'image', imageTag: source.imageTag }
    });

    reply.code(201);
    return { deployment };
  });

  app.get('/api/deployments/stream', async (_request, reply) => {
    reply.hijack();
    sendSseHeaders(reply);
    reply.raw.write(
      sseEvent(
        'snapshot',
        { deployments: services.repository.listDeployments() },
        'snapshot'
      )
    );

    const unsubscribe = services.eventBus.subscribeDeployments((deployment) => {
      reply.raw.write(sseEvent('deployment', { deployment }));
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(': keep-alive\n\n');
    }, 15000);

    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });

  app.get('/api/deployments/:id/events', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const deployment = services.repository.getDeployment(params.id);

    if (!deployment) {
      reply.code(404);
      return { error: 'Deployment not found' };
    }

    reply.hijack();
    sendSseHeaders(reply);

    const lastEventId = Number(request.headers['last-event-id'] || '0') || 0;
    const historical = services.repository.listLogs(params.id, lastEventId);

    for (const log of historical) {
      reply.raw.write(sseEvent('log', { log }, log.seq));
    }

    const unsubscribe = services.eventBus.subscribeLogs(params.id, (log) => {
      reply.raw.write(sseEvent('log', { log }, log.seq));
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(': keep-alive\n\n');
    }, 15000);

    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });

  return app;
}
