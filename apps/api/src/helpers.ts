import crypto from 'node:crypto';
import path from 'node:path';

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(): string {
  return crypto.randomUUID();
}

export function sanitizeSlug(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/\.git$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);

  return normalized || 'deployment';
}

export function deriveSlug(sourceLabel: string, id: string): string {
  return `${sanitizeSlug(sourceLabel)}-${id.slice(0, 8)}`;
}

export function sourceNameFromGitUrl(gitUrl: string): string {
  try {
    const parsed = new URL(gitUrl);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    return segment || parsed.hostname;
  } catch {
    const segment = gitUrl.split('/').filter(Boolean).pop();
    return segment || gitUrl;
  }
}

export function sanitizeUploadName(filename: string): string {
  const basename = path.basename(filename);
  const normalized = basename
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'upload.zip';
}

export function resolveInside(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const normalizedRoot = `${path.resolve(root)}${path.sep}`;

  if (target !== path.resolve(root) && !target.startsWith(normalizedRoot)) {
    throw new Error('Archive contains an invalid path.');
  }

  return target;
}

export function sseEvent(
  event: string,
  data: unknown,
  id?: string | number
): string {
  const lines = [];

  if (id !== undefined) {
    lines.push(`id: ${id}`);
  }

  lines.push(`event: ${event}`);

  const payload = JSON.stringify(data);
  for (const line of payload.split('\n')) {
    lines.push(`data: ${line}`);
  }

  lines.push('', '');
  return lines.join('\n');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
