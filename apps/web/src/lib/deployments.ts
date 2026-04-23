export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'deploying'
  | 'running'
  | 'failed';

export interface DeploymentRecord {
  id: string;
  slug: string;
  sourceType: 'git' | 'archive';
  sourceLabel: string;
  status: DeploymentStatus;
  imageTag: string | null;
  publicUrl: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
}

export interface DeploymentLogRecord {
  seq: number;
  deploymentId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  createdAt: string;
}

export interface DeploymentDetailResponse {
  deployment: DeploymentRecord;
  logs: DeploymentLogRecord[];
}

export const deploymentsKey = ['deployments'] as const;
export const sampleAppUrl = '/api/sample-app';

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  return payload;
}

export async function getDeployments(): Promise<DeploymentRecord[]> {
  const response = await fetch('/api/deployments');

  if (!response.ok) {
    throw new Error('Unable to load deployments.');
  }

  const payload = await readJson<{ deployments: DeploymentRecord[] }>(response);
  return payload.deployments;
}

export async function getDeployment(id: string): Promise<DeploymentDetailResponse> {
  const response = await fetch(`/api/deployments/${id}`);

  if (!response.ok) {
    throw new Error('Unable to load deployment.');
  }

  return readJson<DeploymentDetailResponse>(response);
}

export async function createDeployment(formData: FormData): Promise<DeploymentRecord> {
  const response = await fetch('/api/deployments', {
    method: 'POST',
    body: formData
  });

  const payload = (await response.json()) as
    | { deployment: DeploymentRecord }
    | { error: string };

  if (!response.ok || !('deployment' in payload)) {
    throw new Error('error' in payload ? payload.error : 'Unable to create deployment.');
  }

  return payload.deployment;
}

export async function redeployDeployment(id: string): Promise<DeploymentRecord> {
  const response = await fetch(`/api/deployments/${id}/redeploy`, {
    method: 'POST'
  });

  const payload = (await response.json()) as
    | { deployment: DeploymentRecord }
    | { error: string };

  if (!response.ok || !('deployment' in payload)) {
    throw new Error('error' in payload ? payload.error : 'Unable to redeploy.');
  }

  return payload.deployment;
}

export function statusLabel(status: DeploymentStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'building':
      return 'Building';
    case 'deploying':
      return 'Deploying';
    case 'running':
      return 'Running';
    case 'failed':
      return 'Failed';
  }
}

export function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleString();
}

export function formatRelativeAge(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);

  if (minutes < 1) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function applyDeploymentUpdate(
  deployments: DeploymentRecord[] | undefined,
  incoming: DeploymentRecord
): DeploymentRecord[] {
  const current = deployments ?? [];
  const next = current.filter((deployment) => deployment.id !== incoming.id);
  next.unshift(incoming);
  return next.sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

export function mergeLogs(
  current: DeploymentLogRecord[],
  incoming: DeploymentLogRecord[]
): DeploymentLogRecord[] {
  const merged = new Map<number, DeploymentLogRecord>();

  for (const log of current) {
    merged.set(log.seq, log);
  }

  for (const log of incoming) {
    merged.set(log.seq, log);
  }

  return Array.from(merged.values()).sort((left, right) => left.seq - right.seq);
}
