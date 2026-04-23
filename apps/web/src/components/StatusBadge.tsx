import { statusLabel, type DeploymentStatus } from '../lib/deployments.js';

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  return <span className={`status-badge status-${status}`}>{statusLabel(status)}</span>;
}
