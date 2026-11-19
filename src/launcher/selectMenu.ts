import { clearScreenDown, emitKeypressEvents, moveCursor } from 'node:readline';
import { plainPalette, type Palette } from './palette';

export interface MenuOption {
  /** Single-letter shortcut, also the value returned when this option is chosen. */
  key: string;
  label: string;
}

interface Keypress {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

export interface KeyInput extends NodeJS.ReadableStream {
  setRawMode?(mode: boolean): unknown;
}

export interface SelectEnvironment {
  input: KeyInput;
  output: NodeJS.WritableStream;
  paint?: Palette;
  /** Called on Ctrl+C. The selection promise then never settles. */
  onInterrupt: () => void;
}

const HINT = 'Use the arrow keys and Enter, or press a letter.';
const HIDE_CURSOR = '\u001B[?25l';
const SHOW_CURSOR = '\u001B[?25h';

/** Moves the selection up or down, wrapping at either end. */
export function moveSelection(current: number, count: number, step: -1 | 1): number {
  return (current + step + count) % count;
}

export function renderMenu(options: MenuOption[], selected: number, paint: Palette = plainPalette): string[] {
  const rows = options.map((option, index) => {
    const text = `${option.label} (${option.key})`;
    return index === selected ? paint.accent(paint.bold(`> ${text}`)) : `  ${text}`;
  });
  return [...rows, paint.dim(HINT)];
}

/** Shows a vertical menu and resolves with the key of the chosen option. */
export function selectOption(options: MenuOption[], environment: SelectEnvironment): Promise<string> {
  const { input, output, onInterrupt, paint = plainPalette } = environment;
  let selected = 0;
  let drawnLines = 0;

  const erase = (): void => {
    if (drawnLines === 0) return;
    moveCursor(output, 0, -drawnLines);
    clearScreenDown(output);
  };
  const draw = (): void => {
    erase();
    const lines = renderMenu(options, selected, paint);
    output.write(`${lines.join('\n')}\n`);
    drawnLines = lines.length;
  };

  return new Promise((resolve) => {
    const stopListening = (): void => {
      input.off('keypress', onKeypress);
      input.setRawMode?.(false);
      input.pause();
      output.write(SHOW_CURSOR);
    };
    const choose = (option: MenuOption): void => {
      stopListening();
      erase();
      output.write(`${paint.dim('>')} ${option.label}\n`);
      resolve(option.key);
    };
    const onKeypress = (_text: string | undefined, key: Keypress = {}): void => {
      if (key.ctrl && key.name === 'c') {
        stopListening();
        onInterrupt();
      } else if (key.name === 'up' || key.name === 'down') {
        selected = moveSelection(selected, options.length, key.name === 'up' ? -1 : 1);
        draw();
      } else if (key.name === 'return' || key.name === 'enter') {
        const option = options[selected];
        if (option) choose(option);
      } else {
        const shortcut = options.find((option) => option.key === key.sequence?.toLowerCase());
        if (shortcut) choose(shortcut);
      }
    };

    emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.on('keypress', onKeypress);
    input.resume();
    output.write(HIDE_CURSOR);
    draw();
  });
}
