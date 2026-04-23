import { spawn } from 'node:child_process';

function emitLines(
  chunk: Buffer,
  stream: 'stdout' | 'stderr',
  buffers: { stdout: string; stderr: string },
  onLine: (stream: 'stdout' | 'stderr', line: string) => void
): void {
  buffers[stream] += chunk.toString('utf8');
  const parts = buffers[stream].split(/\r?\n/);
  buffers[stream] = parts.pop() ?? '';

  for (const part of parts) {
    if (part.length > 0) {
      onLine(stream, part);
    }
  }
}

export function tailCommand(options: {
  command: string;
  args: string[];
  onLine: (stream: 'stdout' | 'stderr', line: string) => void;
}): () => void {
  const child = spawn(options.command, options.args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const buffers = { stdout: '', stderr: '' };

  child.stdout!.on('data', (chunk: Buffer) => {
    emitLines(chunk, 'stdout', buffers, options.onLine);
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    emitLines(chunk, 'stderr', buffers, options.onLine);
  });

  return () => {
    child.kill('SIGTERM');
  };
}

export async function runLoggedCommand(options: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine: (stream: 'stdout' | 'stderr', line: string) => void;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const buffers = { stdout: '', stderr: '' };

    child.stdout.on('data', (chunk) => {
      emitLines(chunk, 'stdout', buffers, options.onLine);
    });

    child.stderr.on('data', (chunk) => {
      emitLines(chunk, 'stderr', buffers, options.onLine);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (buffers.stdout.length > 0) {
        options.onLine('stdout', buffers.stdout);
      }
      if (buffers.stderr.length > 0) {
        options.onLine('stderr', buffers.stderr);
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${options.command} ${options.args.join(' ')} exited with code ${code ?? 'null'}`
        )
      );
    });
  });
}
