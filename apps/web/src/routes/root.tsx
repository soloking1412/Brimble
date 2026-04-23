import {
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import * as React from 'react';
import { CopyButton } from '../components/CopyButton.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useDeploymentFeed } from '../hooks/useDeploymentFeed.js';
import { useDeploymentLogs } from '../hooks/useDeploymentLogs.js';
import {
  applyDeploymentUpdate,
  createDeployment,
  deploymentsKey,
  formatDate,
  formatRelativeAge,
  getDeployment,
  getDeployments,
  redeployDeployment,
  sampleAppUrl,
  type DeploymentRecord
} from '../lib/deployments.js';

function DeploymentCard(props: {
  deployment: DeploymentRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const { deployment, selected, onSelect } = props;

  return (
    <button
      type="button"
      className={`deployment-card${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="deployment-card-header">
        <div>
          <div className="deployment-slug">{deployment.slug}</div>
          <div className="deployment-source">{deployment.sourceLabel}</div>
        </div>
        <StatusBadge status={deployment.status} />
      </div>
      <div className="deployment-card-meta">
        <span>{formatRelativeAge(deployment.createdAt)}</span>
        <span>{deployment.imageTag ?? 'Image pending'}</span>
      </div>
    </button>
  );
}

export function DeploymentsPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = React.useState<'git' | 'archive'>('git');
  const [gitUrl, setGitUrl] = React.useState('');
  const [archive, setArchive] = React.useState<File | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [selectedDeploymentId, setSelectedDeploymentId] = React.useState<string | null>(null);
  const archiveInputRef = React.useRef<HTMLInputElement | null>(null);
  const logViewportRef = React.useRef<HTMLDivElement | null>(null);

  const deploymentsQuery = useQuery({
    queryKey: deploymentsKey,
    queryFn: getDeployments
  });

  const selectedDeploymentQuery = useQuery({
    queryKey: ['deployment', selectedDeploymentId],
    queryFn: () => getDeployment(selectedDeploymentId!),
    enabled: Boolean(selectedDeploymentId)
  });

  const createMutation = useMutation({
    mutationFn: createDeployment,
    onSuccess: (deployment) => {
      queryClient.setQueryData<DeploymentRecord[]>(deploymentsKey, (current) =>
        applyDeploymentUpdate(current, deployment)
      );
      setSelectedDeploymentId(deployment.id);
      setGitUrl('');
      setArchive(null);
      if (archiveInputRef.current) {
        archiveInputRef.current.value = '';
      }
      setFormError(null);
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Unable to create deployment.');
    }
  });

  const redeployMutation = useMutation({
    mutationFn: redeployDeployment,
    onSuccess: (deployment) => {
      queryClient.setQueryData<DeploymentRecord[]>(deploymentsKey, (current) =>
        applyDeploymentUpdate(current, deployment)
      );
      setSelectedDeploymentId(deployment.id);
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Unable to redeploy.');
    }
  });

  useDeploymentFeed(selectedDeploymentId);

  const deployments = deploymentsQuery.data ?? [];
  const selectedDeploymentResponse = selectedDeploymentQuery.data;
  const selectedDeployment =
    selectedDeploymentResponse?.deployment ??
    deployments.find((deployment) => deployment.id === selectedDeploymentId) ??
    null;
  const { logs, streamState } = useDeploymentLogs(
    selectedDeploymentId,
    selectedDeploymentResponse?.logs ?? []
  );

  React.useEffect(() => {
    const firstDeployment = deployments[0];
    if (!selectedDeploymentId && firstDeployment) {
      setSelectedDeploymentId(firstDeployment.id);
    }
  }, [deployments, selectedDeploymentId]);

  React.useEffect(() => {
    const viewport = logViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [logs]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData();
    if (mode === 'git') {
      const trimmed = gitUrl.trim();
      if (!trimmed) {
        setFormError('Enter a Git URL.');
        return;
      }
      formData.set('gitUrl', trimmed);
    } else {
      if (!archive) {
        setFormError('Choose a zip archive.');
        return;
      }
      formData.set('archive', archive);
    }

    await createMutation.mutateAsync(formData);
  };

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Brimble scoped delivery</p>
          <h1>Build, run, route, and watch deployments from one surface.</h1>
          <p className="hero-text">
            This demo takes a Git repository or zip upload, builds it with Railpack,
            starts a Docker container, rewires Caddy, and streams the pipeline live.
          </p>
        </div>
        <div className="hero-stats" aria-label="Deployment summary">
          <div className="stat-card">
            <span className="stat-label">Total</span>
            <strong>{deployments.length}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Running</span>
            <strong>{deployments.filter((deployment) => deployment.status === 'running').length}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Failures</span>
            <strong>{deployments.filter((deployment) => deployment.status === 'failed').length}</strong>
          </div>
        </div>
      </section>

      <section className="grid-shell">
        <form className="panel form-panel" onSubmit={submit}>
          <div className="panel-head">
            <h2>Create deployment</h2>
            <p>Use a public Git URL or a local zip archive.</p>
          </div>

          <fieldset className="mode-toggle" aria-label="Source type">
            <label className={`toggle-option${mode === 'git' ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="source-type"
                checked={mode === 'git'}
                onChange={() => {
                  setMode('git');
                  setFormError(null);
                }}
              />
              <span>Git URL</span>
            </label>
            <label className={`toggle-option${mode === 'archive' ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="source-type"
                checked={mode === 'archive'}
                onChange={() => {
                  setMode('archive');
                  setFormError(null);
                }}
              />
              <span>Zip upload</span>
            </label>
          </fieldset>

          {mode === 'git' ? (
            <label className="field">
              <span>Repository URL</span>
              <input
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://github.com/owner/repo"
                value={gitUrl}
                onChange={(event) => setGitUrl(event.target.value)}
              />
            </label>
          ) : (
            <label className="field">
              <span>Zip archive</span>
              <input
                ref={archiveInputRef}
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
              />
              <small>{archive?.name ?? 'Upload only .zip archives.'}</small>
            </label>
          )}

          <div className="form-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Starting deployment…' : 'Start deployment'}
            </button>
            <a className="secondary-link" href={sampleAppUrl}>
              Download sample zip
            </a>
          </div>

          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
        </form>

        <section className="panel list-panel" aria-labelledby="deployment-list-title">
          <div className="panel-head">
            <h2 id="deployment-list-title">Deployments</h2>
            <p>{deploymentsQuery.isLoading ? 'Loading current state…' : 'Live updates arrive over SSE.'}</p>
          </div>

          {deploymentsQuery.isError ? (
            <div className="empty-state">
              <strong>Unable to load deployments.</strong>
              <p>Refresh the page or inspect the API container logs.</p>
            </div>
          ) : null}

          {!deploymentsQuery.isError && deployments.length === 0 ? (
            <div className="empty-state">
              <strong>No deployments yet.</strong>
              <p>Create one from the form to start the full Railpack to Docker to Caddy flow.</p>
            </div>
          ) : null}

          <div className="deployment-list">
            {deployments.map((deployment) => (
              <DeploymentCard
                key={deployment.id}
                deployment={deployment}
                selected={deployment.id === selectedDeploymentId}
                onSelect={() => setSelectedDeploymentId(deployment.id)}
              />
            ))}
          </div>
        </section>

        <section className="panel detail-panel" aria-labelledby="detail-title">
          <div className="panel-head">
            <h2 id="detail-title">Deployment detail</h2>
            <p>
              {selectedDeployment
                ? `Log stream ${streamState === 'open' ? 'connected' : streamState === 'connecting' ? 'reconnecting' : 'idle'}.`
                : 'Select a deployment to inspect logs and metadata.'}
            </p>
          </div>

          {!selectedDeployment ? (
            <div className="empty-state">
              <strong>No deployment selected.</strong>
              <p>Choose a deployment from the list to see its image tag, URL, and pipeline logs.</p>
            </div>
          ) : (
            <>
              <div className="detail-grid">
                <div className="detail-card">
                  <span className="detail-label">Status</span>
                  <div className="detail-value">
                    <StatusBadge status={selectedDeployment.status} />
                  </div>
                </div>
                <div className="detail-card">
                  <span className="detail-label">Source</span>
                  <div className="detail-stack">
                    <span className="source-pill">{selectedDeployment.sourceType}</span>
                    <span>{selectedDeployment.sourceLabel}</span>
                  </div>
                </div>
                <div className="detail-card">
                  <span className="detail-label">Created</span>
                  <div className="detail-value">{formatDate(selectedDeployment.createdAt)}</div>
                </div>
                <div className="detail-card">
                  <span className="detail-label">Finished</span>
                  <div className="detail-value">{formatDate(selectedDeployment.finishedAt)}</div>
                </div>
                <div className="detail-card detail-card-wide">
                  <span className="detail-label">Image tag</span>
                  <div className="detail-stack">
                    <code>{selectedDeployment.imageTag ?? 'Pending build output'}</code>
                    <CopyButton label="image tag" value={selectedDeployment.imageTag} />
                  </div>
                </div>
                <div className="detail-card detail-card-wide">
                  <span className="detail-label">Live URL</span>
                  <div className="detail-stack">
                    {selectedDeployment.publicUrl ? (
                      <a href={selectedDeployment.publicUrl} target="_blank" rel="noreferrer">
                        {selectedDeployment.publicUrl}
                      </a>
                    ) : (
                      <span>Waiting for a successful deploy.</span>
                    )}
                    <CopyButton label="URL" value={selectedDeployment.publicUrl} />
                  </div>
                </div>
                {selectedDeployment.failureReason ? (
                  <div className="detail-card detail-card-wide detail-card-danger">
                    <span className="detail-label">Failure reason</span>
                    <div className="detail-value">{selectedDeployment.failureReason}</div>
                  </div>
                ) : null}

                {selectedDeployment.imageTag &&
                (selectedDeployment.status === 'running' ||
                  selectedDeployment.status === 'failed') ? (
                  <div className="detail-card detail-card-wide">
                    <span className="detail-label">Redeploy</span>
                    <div>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={redeployMutation.isPending}
                        onClick={() => redeployMutation.mutate(selectedDeployment.id)}
                      >
                        {redeployMutation.isPending
                          ? 'Starting redeploy…'
                          : `Redeploy ${selectedDeployment.imageTag}`}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="log-shell">
                <div className="log-toolbar">
                  <span className={`stream-dot stream-${streamState}`} aria-hidden="true" />
                  <span>Build and deploy logs</span>
                </div>
                <div className="log-viewport" ref={logViewportRef}>
                  {logs.length === 0 ? (
                    <p className="log-empty">No logs yet.</p>
                  ) : (
                    logs.map((log) => (
                      <div key={log.seq} className={`log-line log-${log.stream}`}>
                        <span className="log-seq">#{log.seq}</span>
                        <span className="log-stream">{log.stream}</span>
                        <span className="log-text">{log.line}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
