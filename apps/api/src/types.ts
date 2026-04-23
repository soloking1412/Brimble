export const deploymentStatuses = [
  'pending',
  'building',
  'deploying',
  'running',
  'failed'
] as const;

export type DeploymentStatus = (typeof deploymentStatuses)[number];
export type DeploymentSourceType = 'git' | 'archive';

export interface DeploymentRecord {
  id: string;
  slug: string;
  sourceType: DeploymentSourceType;
  sourceLabel: string;
  status: DeploymentStatus;
  imageTag: string | null;
  publicUrl: string | null;
  containerName: string | null;
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

export interface CreateDeploymentInput {
  id: string;
  slug: string;
  sourceType: DeploymentSourceType;
  sourceLabel: string;
}

export interface DeploymentJobGit {
  type: 'git';
  gitUrl: string;
}

export interface DeploymentJobArchive {
  type: 'archive';
  archivePath: string;
  originalName: string;
}

export interface DeploymentJobImage {
  type: 'image';
  imageTag: string;
}

export type DeploymentJobSource = DeploymentJobGit | DeploymentJobArchive | DeploymentJobImage;

export interface AppConfig {
  port: number;
  dataDir: string;
  rootHost: string;
  publicPort: number;
  publicHostSuffix: string;
  caddyAdminUrl: string;
  dockerNetwork: string;
  appPort: number;
  railpackBin: string;
  sampleAppPath: string;
}
