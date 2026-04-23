import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import {
  applyDeploymentUpdate,
  type DeploymentRecord,
  deploymentsKey
} from '../lib/deployments.js';

export function useDeploymentFeed(selectedDeploymentId: string | null): void {
  const queryClient = useQueryClient();

  const onDeployment = React.useEffectEvent((deployment: DeploymentRecord) => {
    queryClient.setQueryData<DeploymentRecord[]>(deploymentsKey, (current) =>
      applyDeploymentUpdate(current, deployment)
    );

    if (selectedDeploymentId === deployment.id) {
      queryClient.setQueryData(['deployment', deployment.id], (current) => ({
        ...(current as { logs?: unknown } | undefined),
        deployment
      }));
    }
  });

  React.useEffect(() => {
    const source = new EventSource('/api/deployments/stream');

    source.addEventListener('snapshot', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        deployments: DeploymentRecord[];
      };
      queryClient.setQueryData(deploymentsKey, payload.deployments);
    });

    source.addEventListener('deployment', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        deployment: DeploymentRecord;
      };
      onDeployment(payload.deployment);
    });

    return () => {
      source.close();
    };
  }, [onDeployment, queryClient]);
}
