import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveSlug, makeId } from '../src/helpers.js';
import { Repository } from '../src/repository.js';

test('replays only logs after the provided sequence id', () => {
  const repository = new Repository(':memory:');
  const id = makeId();

  repository.createDeployment({
    id,
    slug: deriveSlug('hello', id),
    sourceType: 'git',
    sourceLabel: 'https://github.com/example/hello'
  });

  repository.appendLog(id, 'system', 'queued');
  repository.appendLog(id, 'stdout', 'building');
  const third = repository.appendLog(id, 'stderr', 'boom');

  const replay = repository.listLogs(id, 2);

  assert.equal(replay.length, 1);
  assert.equal(replay[0]?.seq, third.seq);
  assert.equal(replay[0]?.line, 'boom');

  repository.close();
});

test('marks interrupted deployments as failed during recovery', () => {
  const repository = new Repository(':memory:');
  const pendingId = makeId();
  const buildingId = makeId();

  repository.createDeployment({
    id: pendingId,
    slug: deriveSlug('pending', pendingId),
    sourceType: 'git',
    sourceLabel: 'https://github.com/example/pending'
  });

  repository.createDeployment({
    id: buildingId,
    slug: deriveSlug('building', buildingId),
    sourceType: 'git',
    sourceLabel: 'https://github.com/example/building'
  });

  repository.updateDeployment(buildingId, {
    status: 'building'
  });

  const failed = repository.failRecoverableDeployments('interrupted');

  assert.equal(failed.length, 2);
  assert.equal(repository.getDeploymentOrThrow(pendingId).status, 'failed');
  assert.equal(repository.getDeploymentOrThrow(buildingId).status, 'failed');
  assert.equal(repository.getDeploymentOrThrow(buildingId).failureReason, 'interrupted');

  repository.close();
});
