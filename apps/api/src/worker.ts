import fsp from 'node:fs/promises';
import path from 'node:path';
import type { EventBus } from './event-bus.js';
import { buildCaddyfile, loadCaddyConfig } from './caddy.js';
import { runLoggedCommand, tailCommand } from './command.js';
import { nowIso, sleep } from './helpers.js';
import type {
  AppConfig,
  DeploymentJobSource,
  DeploymentLogRecord,
  DeploymentRecord
} from './types.js';
import { Repository } from './repository.js';
import { stageSource } from './source.js';

interface QueueItem {
  deploymentId: string;
  source: DeploymentJobSource;
}

export class DeploymentWorker {
  private queue: QueueItem[] = [];
  private running = false;
  private logTails = new Map<string, () => void>();

  constructor(
    private readonly repository: Repository,
    private readonly eventBus: EventBus,
    private readonly config: AppConfig
  ) {}

  async enqueue(item: QueueItem): Promise<void> {
    this.queue.push(item);
    void this.pump();
  }

  async recover(): Promise<void> {
    const failed = this.repository.failRecoverableDeployments(
      'The API restarted before this deployment completed.'
    );

    for (const deployment of failed) {
      const log = this.repository.appendLog(
        deployment.id,
        'system',
        deployment.failureReason ?? 'Deployment interrupted.'
      );
      this.eventBus.publishLog(log);
      this.eventBus.publishDeployment(deployment);
    }

    for (const deployment of this.repository.listRunningDeployments()) {
      if (deployment.containerName) {
        this.startRuntimeLogs(deployment.id, deployment.containerName);
      }
    }
  }

  async syncCaddy(extraDeployments: DeploymentRecord[] = []): Promise<void> {
    const deployments = this.mergeDeployments(
      this.repository.listRunningDeployments(),
      extraDeployments
    );
    await loadCaddyConfig(
      this.config.caddyAdminUrl,
      buildCaddyfile(this.config, deployments)
    );
  }

  private async pump(): Promise<void> {
    if (this.running) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    this.running = true;

    try {
      await this.process(next);
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  private async process(item: QueueItem): Promise<void> {
    const workspaceDir = path.join(this.config.dataDir, 'workspaces', item.deploymentId);
    await fsp.mkdir(workspaceDir, { recursive: true });

    try {
      const imageTag = await this.buildImage(item, workspaceDir);
      await this.deployContainer(item.deploymentId, imageTag);
    } catch (error) {
      await this.handleFailure(item.deploymentId, error);
    } finally {
      await fsp.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async buildImage(item: QueueItem, workspaceDir: string): Promise<string> {
    if (item.source.type === 'image') {
      await this.appendLog(item.deploymentId, 'system', `Reusing image ${item.source.imageTag}`);
      return item.source.imageTag;
    }

    const started = this.repository.updateDeployment(item.deploymentId, {
      status: 'building',
      startedAt: nowIso(),
      finishedAt: null,
      failureReason: null
    });
    this.eventBus.publishDeployment(started);

    const sourceDir = await stageSource({
      source: item.source,
      workspaceDir,
      onLine: (stream, line) => this.appendLog(item.deploymentId, stream, line)
    });

    const planPath = path.join(workspaceDir, 'railpack-plan.json');
    const infoPath = path.join(workspaceDir, 'railpack-info.json');
    const imageTag = `brimble/${started.slug}:${Date.now()}`;
    const latestTag = `brimble/${started.slug}:latest`;

    await this.appendLog(item.deploymentId, 'system', 'Generating Railpack plan');
    await runLoggedCommand({
      command: this.config.railpackBin,
      args: ['prepare', sourceDir, '--plan-out', planPath, '--info-out', infoPath],
      cwd: workspaceDir,
      onLine: (stream, line) => {
        void this.appendLog(item.deploymentId, stream, line);
      }
    });

    await this.appendLog(item.deploymentId, 'system', `Building image ${imageTag}`);
    await runLoggedCommand({
      command: 'docker',
      args: [
        'buildx',
        'build',
        '--load',
        '--build-arg',
        'BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend',
        '--cache-from',
        latestTag,
        '-f',
        planPath,
        '-t',
        imageTag,
        '-t',
        latestTag,
        sourceDir
      ],
      cwd: workspaceDir,
      onLine: (stream, line) => {
        void this.appendLog(item.deploymentId, stream, line);
      }
    });

    return imageTag;
  }

  private async deployContainer(deploymentId: string, imageTag: string): Promise<void> {
    const current = this.repository.getDeploymentOrThrow(deploymentId);
    const containerName = `brimble-${deploymentId}`;
    const publicUrl = `http://${current.slug}.${this.config.publicHostSuffix}:${this.config.publicPort}`;

    const deploying = this.repository.updateDeployment(deploymentId, {
      status: 'deploying',
      startedAt: current.startedAt ?? nowIso(),
      imageTag,
      publicUrl,
      containerName
    });
    this.eventBus.publishDeployment(deploying);

    await this.appendLog(deploymentId, 'system', `Starting container ${containerName}`);
    await runLoggedCommand({
      command: 'docker',
      args: ['rm', '-f', containerName],
      onLine: () => undefined
    }).catch(() => undefined);

    await runLoggedCommand({
      command: 'docker',
      args: [
        'run',
        '-d',
        '--name',
        containerName,
        '--network',
        this.config.dockerNetwork,
        '--label',
        `brimble.deployment=${deploymentId}`,
        '-e',
        `PORT=${this.config.appPort}`,
        imageTag
      ],
      onLine: (stream, line) => {
        void this.appendLog(deploymentId, stream, line);
      }
    });

    await this.waitForContainer(deploymentId, containerName);
    await this.appendLog(deploymentId, 'system', 'Publishing route in Caddy');

    const completed = this.repository.updateDeployment(deploymentId, {
      status: 'running',
      finishedAt: nowIso(),
      failureReason: null
    });
    await this.syncCaddy([completed]);

    await this.appendLog(deploymentId, 'system', `Deployment running at ${publicUrl}`);
    this.eventBus.publishDeployment(completed);
    this.startRuntimeLogs(deploymentId, containerName);
  }

  private async handleFailure(deploymentId: string, error: unknown): Promise<void> {
    this.stopRuntimeLogs(deploymentId);
    const current = this.repository.getDeploymentOrThrow(deploymentId);

    if (current.containerName) {
      await runLoggedCommand({
        command: 'docker',
        args: ['rm', '-f', current.containerName],
        onLine: () => undefined
      }).catch(() => undefined);
    }

    const message =
      error instanceof Error ? error.message : 'Deployment failed for an unknown reason.';

    await this.appendLog(deploymentId, 'system', message);
    const failed = this.repository.updateDeployment(deploymentId, {
      status: 'failed',
      finishedAt: nowIso(),
      failureReason: message
    });
    this.eventBus.publishDeployment(failed);

    await this.syncCaddy().catch(() => undefined);
  }

  private startRuntimeLogs(deploymentId: string, containerName: string): void {
    const cancel = tailCommand({
      command: 'docker',
      args: ['logs', '-f', '--tail', '0', containerName],
      onLine: (stream, line) => {
        void this.appendLog(deploymentId, stream, line);
      }
    });
    this.logTails.set(deploymentId, cancel);
  }

  private stopRuntimeLogs(deploymentId: string): void {
    const cancel = this.logTails.get(deploymentId);
    if (cancel) {
      cancel();
      this.logTails.delete(deploymentId);
    }
  }

  private mergeDeployments(
    current: DeploymentRecord[],
    extras: DeploymentRecord[]
  ): DeploymentRecord[] {
    const merged = new Map<string, DeploymentRecord>();

    for (const deployment of current) {
      merged.set(deployment.id, deployment);
    }

    for (const deployment of extras) {
      merged.set(deployment.id, deployment);
    }

    return Array.from(merged.values()).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );
  }

  private async appendLog(
    deploymentId: string,
    stream: DeploymentLogRecord['stream'],
    line: string
  ): Promise<void> {
    const log = this.repository.appendLog(deploymentId, stream, line);
    this.eventBus.publishLog(log);
  }

  private async waitForContainer(
    deploymentId: string,
    containerName: string
  ): Promise<void> {
    const url = `http://${containerName}:${this.config.appPort}/`;

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await this.appendLog(
        deploymentId,
        'system',
        `Health check ${attempt}/20 ${url}`
      );

      try {
        const response = await fetch(url);
        if (response.status < 500) {
          return;
        }
      } catch {}

      await sleep(1000);
    }

    await this.appendLog(deploymentId, 'system', `Container ${containerName} never became healthy`);
    await this.captureContainerLogs(deploymentId, containerName);

    throw new Error(
      `Container did not become healthy on port ${this.config.appPort}. The app must bind 0.0.0.0:${this.config.appPort}.`
    );
  }

  private async captureContainerLogs(
    deploymentId: string,
    containerName: string
  ): Promise<void> {
    await this.appendLog(deploymentId, 'system', `Collecting container logs from ${containerName}`);
    await runLoggedCommand({
      command: 'docker',
      args: ['logs', containerName],
      onLine: (stream, line) => {
        void this.appendLog(deploymentId, stream, line);
      }
    }).catch(() => undefined);
  }
}
