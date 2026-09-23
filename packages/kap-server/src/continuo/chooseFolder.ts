import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

import { ContinuoError } from './errors';

const run = promisify(execFile);

function quote(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export async function chooseFolder(prompt: string, defaultPath: string | undefined): Promise<string | undefined> {
  if (process.platform !== 'darwin') throw new ContinuoError('invalid_state', '只有在 macOS 上才能打开系统的文件夹窗口。');
  const from = defaultPath !== undefined && existsSync(defaultPath) ? ` default location (POSIX file "${quote(defaultPath)}")` : '';
  const script = [
    'try',
    '  activate',
    `  return POSIX path of (choose folder with prompt "${quote(prompt)}"${from})`,
    'on error number -128',
    '  return ""',
    'end try',
  ].join('\n');
  const { stdout } = await run('osascript', ['-e', script]);
  const path = stdout.trim();
  if (path === '') return undefined;
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}
