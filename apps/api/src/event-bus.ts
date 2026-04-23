import type { DeploymentLogRecord, DeploymentRecord } from './types.js';

type DeploymentListener = (deployment: DeploymentRecord) => void;
type LogListener = (log: DeploymentLogRecord) => void;

export class EventBus {
  private deploymentListeners = new Set<DeploymentListener>();
  private logListeners = new Map<string, Set<LogListener>>();
  private deploymentEventId = 0;

  subscribeDeployments(listener: DeploymentListener): () => void {
    this.deploymentListeners.add(listener);
    return () => {
      this.deploymentListeners.delete(listener);
    };
  }

  publishDeployment(deployment: DeploymentRecord): string {
    this.deploymentEventId += 1;
    for (const listener of this.deploymentListeners) {
      listener(deployment);
    }
    return String(this.deploymentEventId);
  }

  subscribeLogs(deploymentId: string, listener: LogListener): () => void {
    const listeners = this.logListeners.get(deploymentId) ?? new Set<LogListener>();
    listeners.add(listener);
    this.logListeners.set(deploymentId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.logListeners.delete(deploymentId);
      }
    };
  }

  publishLog(log: DeploymentLogRecord): void {
    const listeners = this.logListeners.get(log.deploymentId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(log);
    }
  }
}
