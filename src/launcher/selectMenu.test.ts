import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { moveSelection, renderMenu, selectOption, type MenuOption } from './selectMenu';

const OPTIONS: MenuOption[] = [
  { key: 'r', label: 'Refresh feed' },
  { key: 's', label: 'System status' },
  { key: 'q', label: 'Quit' },
];

const UP = '\u001B[A';
const DOWN = '\u001B[B';
const ENTER = '\r';
const CTRL_C = '\u0003';

function startMenu() {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk: Buffer) => (written += chunk.toString()));
  const onInterrupt = vi.fn();
  const choice = selectOption(OPTIONS, { input, output, onInterrupt });
  return { input, choice, onInterrupt, written: () => written };
}

describe('moveSelection', () => {
  it('moves by one and wraps at both ends', () => {
    expect(moveSelection(0, 3, 1)).toBe(1);
    expect(moveSelection(2, 3, 1)).toBe(0);
    expect(moveSelection(0, 3, -1)).toBe(2);
  });
});

describe('renderMenu', () => {
  it('lists options vertically and marks only the selected one', () => {
    expect(renderMenu(OPTIONS, 1)).toEqual([
      '  Refresh feed (r)',
      '> System status (s)',
      '  Quit (q)',
      'Use the arrow keys and Enter, or press a letter.',
    ]);
  });
});

describe('selectOption', () => {
  it('chooses the first option when Enter is pressed straight away', async () => {
    const { input, choice } = startMenu();
    input.write(ENTER);
    expect(await choice).toBe('r');
  });

  it('follows the arrow keys', async () => {
    const { input, choice, written } = startMenu();
    input.write(DOWN);
    input.write(DOWN);
    input.write(UP);
    input.write(ENTER);
    expect(await choice).toBe('s');
    expect(written()).toContain('> System status');
  });

  it('wraps from the first option to the last', async () => {
    const { input, choice } = startMenu();
    input.write(UP);
    input.write(ENTER);
    expect(await choice).toBe('q');
  });

  it('accepts a letter shortcut in either case', async () => {
    const { input, choice } = startMenu();
    input.write('S');
    expect(await choice).toBe('s');
  });

  it('ignores keys that are not shortcuts', async () => {
    const { input, choice } = startMenu();
    input.write('x');
    input.write('q');
    expect(await choice).toBe('q');
  });

  it('reports Ctrl+C instead of choosing anything', async () => {
    const { input, choice, onInterrupt } = startMenu();
    const settled = vi.fn();
    void choice.then(settled);
    input.write(CTRL_C);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
  });
});
