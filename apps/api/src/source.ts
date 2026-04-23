import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import unzipper from 'unzipper';
import type { DeploymentJobArchive, DeploymentJobGit } from './types.js';
import { runLoggedCommand } from './command.js';
import { resolveInside } from './helpers.js';

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  const parser = fs.createReadStream(archivePath).pipe(unzipper.Parse());

  for await (const entry of parser) {
    const entryPath = entry.path.replace(/\\/g, '/');

    if (!entryPath || entryPath.startsWith('__MACOSX/')) {
      entry.autodrain();
      continue;
    }

    const destination = resolveInside(targetDir, entryPath);

    if (entry.type === 'Directory') {
      await ensureDir(destination);
      entry.autodrain();
      continue;
    }

    await ensureDir(path.dirname(destination));
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(destination, { mode: 0o644 });
      entry.pipe(output);
      output.on('finish', () => resolve());
      output.on('error', reject);
      entry.on('error', reject);
    });
  }
}

async function findSourceRoot(directory: string): Promise<string> {
  const entries = await fsp.readdir(directory, { withFileTypes: true });

  if (entries.length !== 1) {
    return directory;
  }

  const [entry] = entries;
  if (entry && entry.isDirectory()) {
    return path.join(directory, entry.name);
  }

  return directory;
}

export async function stageSource(options: {
  source: DeploymentJobGit | DeploymentJobArchive;
  workspaceDir: string;
  onLine: (stream: 'stdout' | 'stderr' | 'system', line: string) => Promise<void>;
}): Promise<string> {
  const targetDir = path.join(options.workspaceDir, 'source');
  await fsp.rm(targetDir, { recursive: true, force: true });
  await ensureDir(targetDir);

  if (options.source.type === 'git') {
    await options.onLine('system', `Cloning ${options.source.gitUrl}`);
    await runLoggedCommand({
      command: 'git',
      args: ['clone', '--depth', '1', options.source.gitUrl, targetDir],
      onLine: (stream, line) => {
        void options.onLine(stream, line);
      }
    });

    return targetDir;
  }

  await options.onLine('system', `Extracting ${options.source.originalName}`);
  await extractArchive(options.source.archivePath, targetDir);

  return findSourceRoot(targetDir);
}
