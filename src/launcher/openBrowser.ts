import { spawn } from 'node:child_process';

export interface BrowserCommand {
  command: string;
  args: string[];
}

/** The operating system's own "open this address" command. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserCommand {
  // `start` treats its first quoted argument as a window title, hence the empty one.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * Opens the address in the user's default browser. Resolves false when the
 * system has no way to do that (for example a server with no desktop), so the
 * caller can tell the user to open it themselves.
 */
export function openBrowser(url: string, spawnFn: typeof spawn = spawn, platform = process.platform): Promise<boolean> {
  const { command, args } = browserCommand(url, platform);
  return new Promise((resolve) => {
    try {
      const child = spawnFn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        // The browser keeps running on its own; it is not this launcher's process to stop.
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
