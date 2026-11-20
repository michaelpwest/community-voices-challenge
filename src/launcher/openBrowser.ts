import { spawn } from 'node:child_process';

export interface BrowserCommand {
  command: string;
  args: string[];
}

export interface OpenBrowserOptions {
  spawnFn?: typeof spawn;
  platform?: NodeJS.Platform;
}

/**
 * What the open command reported when it finished:
 * - `opened`: it handed the address to a browser.
 * - `failed`: it could not (no such command, no desktop, no default browser).
 * - `unclear`: it ended in a way that says nothing either way.
 */
export type BrowserOpenResult = 'opened' | 'failed' | 'unclear';

/** The operating system's own "open this address" command. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserCommand {
  // `start` treats its first quoted argument as a window title, hence the empty one.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/** xdg-open's own codes for "a required tool was not found" and "the action failed". */
const XDG_OPEN_FAILURES = [3, 4];

/**
 * Reads the open command's exit code. On Linux, xdg-open sometimes runs the
 * browser itself and passes on the browser's exit code, so only its own
 * failure codes count as a failure there.
 */
export function interpretExit(code: number | null, platform: NodeJS.Platform): BrowserOpenResult {
  if (code === 0) return 'opened';
  if (platform === 'win32' || platform === 'darwin') return 'failed';
  return code !== null && XDG_OPEN_FAILURES.includes(code) ? 'failed' : 'unclear';
}

/**
 * Asks the operating system to open the address in the default browser, and
 * resolves once the open command has finished. Never rejects.
 *
 * Callers should not wait on this before carrying on: the command usually
 * finishes in moments, but on some systems it runs for as long as the browser
 * stays open, and on others it takes a long time to give up. In those cases
 * the result arrives late or not at all.
 */
export function openBrowser(url: string, options: OpenBrowserOptions = {}): Promise<BrowserOpenResult> {
  const { spawnFn = spawn, platform = process.platform } = options;
  const { command, args } = browserCommand(url, platform);
  return new Promise((resolve) => {
    try {
      const child = spawnFn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
      // Both listeners stay attached for the life of the child, so a late event is
      // always handled; resolving a second time has no effect.
      child.once('error', () => resolve('failed'));
      child.once('exit', (code) => resolve(interpretExit(code, platform)));
      // The browser is not this launcher's process to wait for or stop.
      child.unref();
    } catch {
      resolve('failed');
    }
  });
}
