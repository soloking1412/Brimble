import * as React from 'react';
import {
  mergeLogs,
  type DeploymentLogRecord
} from '../lib/deployments.js';

export function useDeploymentLogs(
  deploymentId: string | null,
  initialLogs: DeploymentLogRecord[]
) {
  const [logs, setLogs] = React.useState<DeploymentLogRecord[]>(initialLogs);
  const [streamState, setStreamState] = React.useState<'idle' | 'connecting' | 'open'>('idle');

  const appendLog = React.useEffectEvent((log: DeploymentLogRecord) => {
    setLogs((current) => mergeLogs(current, [log]));
  });

  React.useEffect(() => {
    setLogs(initialLogs);
  }, [deploymentId, initialLogs]);

  React.useEffect(() => {
    if (!deploymentId) {
      setStreamState('idle');
      return;
    }

    setStreamState('connecting');
    const source = new EventSource(`/api/deployments/${deploymentId}/events`);

    source.onopen = () => {
      setStreamState('open');
    };

    source.addEventListener('log', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        log: DeploymentLogRecord;
      };
      appendLog(payload.log);
    });

    source.onerror = () => {
      setStreamState('connecting');
    };

    return () => {
      source.close();
    };
  }, [appendLog, deploymentId]);

  return { logs, streamState };
}
