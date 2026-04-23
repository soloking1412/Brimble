import Database from 'better-sqlite3';
import type {
  CreateDeploymentInput,
  DeploymentLogRecord,
  DeploymentRecord,
  DeploymentStatus
} from './types.js';
import { nowIso } from './helpers.js';

function mapDeployment(row: Record<string, unknown>): DeploymentRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    sourceType: row.source_type as DeploymentRecord['sourceType'],
    sourceLabel: String(row.source_label),
    status: row.status as DeploymentStatus,
    imageTag: row.image_tag ? String(row.image_tag) : null,
    publicUrl: row.public_url ? String(row.public_url) : null,
    containerName: row.container_name ? String(row.container_name) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    failureReason: row.failure_reason ? String(row.failure_reason) : null
  };
}

function mapLog(row: Record<string, unknown>): DeploymentLogRecord {
  return {
    seq: Number(row.seq),
    deploymentId: String(row.deployment_id),
    stream: row.stream as DeploymentLogRecord['stream'],
    line: String(row.line),
    createdAt: String(row.created_at)
  };
}

export class Repository {
  private db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_label TEXT NOT NULL,
  status TEXT NOT NULL,
  image_tag TEXT,
  public_url TEXT,
  container_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  failure_reason TEXT
);
CREATE TABLE IF NOT EXISTS deployment_logs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  line TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS deployment_logs_deployment_seq_idx
ON deployment_logs (deployment_id, seq);
    `);
  }

  close(): void {
    this.db.close();
  }

  createDeployment(input: CreateDeploymentInput): DeploymentRecord {
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO deployments (
          id, slug, source_type, source_label, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        input.id,
        input.slug,
        input.sourceType,
        input.sourceLabel,
        timestamp,
        timestamp
      );

    return this.getDeploymentOrThrow(input.id);
  }

  listDeployments(): DeploymentRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM deployments ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];

    return rows.map(mapDeployment);
  }

  listRunningDeployments(): DeploymentRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM deployments WHERE status = 'running' ORDER BY created_at ASC")
      .all() as Record<string, unknown>[];

    return rows.map(mapDeployment);
  }

  getDeployment(id: string): DeploymentRecord | null {
    const row = this.db
      .prepare('SELECT * FROM deployments WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    return row ? mapDeployment(row) : null;
  }

  getDeploymentOrThrow(id: string): DeploymentRecord {
    const deployment = this.getDeployment(id);

    if (!deployment) {
      throw new Error(`Deployment not found: ${id}`);
    }

    return deployment;
  }

  updateDeployment(
    id: string,
    patch: Partial<{
      status: DeploymentStatus;
      imageTag: string | null;
      publicUrl: string | null;
      containerName: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      failureReason: string | null;
    }>
  ): DeploymentRecord {
    const current = this.getDeploymentOrThrow(id);
    const next = {
      status: patch.status ?? current.status,
      imageTag:
        patch.imageTag === undefined ? current.imageTag : patch.imageTag,
      publicUrl:
        patch.publicUrl === undefined ? current.publicUrl : patch.publicUrl,
      containerName:
        patch.containerName === undefined
          ? current.containerName
          : patch.containerName,
      startedAt:
        patch.startedAt === undefined ? current.startedAt : patch.startedAt,
      finishedAt:
        patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt,
      failureReason:
        patch.failureReason === undefined
          ? current.failureReason
          : patch.failureReason,
      updatedAt: nowIso()
    };

    this.db
      .prepare(
        `UPDATE deployments SET
          status = ?,
          image_tag = ?,
          public_url = ?,
          container_name = ?,
          started_at = ?,
          finished_at = ?,
          failure_reason = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        next.status,
        next.imageTag,
        next.publicUrl,
        next.containerName,
        next.startedAt,
        next.finishedAt,
        next.failureReason,
        next.updatedAt,
        id
      );

    return this.getDeploymentOrThrow(id);
  }

  appendLog(
    deploymentId: string,
    stream: DeploymentLogRecord['stream'],
    line: string
  ): DeploymentLogRecord {
    const createdAt = nowIso();

    const result = this.db
      .prepare(
        `INSERT INTO deployment_logs (deployment_id, stream, line, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(deploymentId, stream, line, createdAt);

    return {
      seq: Number(result.lastInsertRowid),
      deploymentId,
      stream,
      line,
      createdAt
    };
  }

  listLogs(
    deploymentId: string,
    afterSeq = 0
  ): DeploymentLogRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM deployment_logs
         WHERE deployment_id = ? AND seq > ?
         ORDER BY seq ASC`
      )
      .all(deploymentId, afterSeq) as Record<string, unknown>[];

    return rows.map(mapLog);
  }

  failRecoverableDeployments(reason: string): DeploymentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM deployments
         WHERE status IN ('pending', 'building', 'deploying')`
      )
      .all() as Array<{ id: string }>;

    const failed: DeploymentRecord[] = [];

    for (const row of rows) {
      failed.push(
        this.updateDeployment(row.id, {
          status: 'failed',
          finishedAt: nowIso(),
          failureReason: reason
        })
      );
    }

    return failed;
  }
}
