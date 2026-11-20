import { spawn } from 'node:child_process';

export interface BrowserCommand {
  command: string;
  args: string[];
}

export interface OpenBrowserOptions {
  spawnFn?: typeof spawn;
  platform?: NodeJS.Platform;
  /** How long to wait for the open command to report a failure before assuming it worked. */
  settleMs?: number;
}

/** The operating system's own "open this address" command. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserCommand {
  // `start` treats its first quoted argument as a window title, hence the empty one.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * Opens the address in the user's default browser. Resolves false when that
 * did not work, so the caller can tell the user to open it themselves.
 *
 * The open command normally exits within moments: with code 0 once it has
 * handed the address to a browser, or with an error code when it cannot (no
 * desktop, no default browser). Some systems instead keep the command running
 * for as long as the browser is open, so one that is still running after
 * `settleMs` is taken to have worked.
 */
export function openBrowser(url: string, options: OpenBrowserOptions = {}): Promise<boolean> {
  const { spawnFn = spawn, platform = process.platform, settleMs = 2000 } = options;
  const { command, args } = browserCommand(url, platform);
  return new Promise((resolve) => {
    try {
      const child = spawnFn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
      const stillRunning = setTimeout(() => finish(true), settleMs);
      const finish = (opened: boolean): void => {
        clearTimeout(stillRunning);
        // The browser keeps running on its own; it is not this launcher's process to wait for or stop.
        child.unref();
        resolve(opened);
      };
      child.once('error', () => finish(false));
      child.once('exit', (code) => finish(code === 0));
    } catch {
      resolve(false);
    }
  });
}
