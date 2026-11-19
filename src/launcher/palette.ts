import { styleText } from 'node:util';

/** Text styles used in launcher output. */
export interface Palette {
  ok(text: string): string;
  warn(text: string): string;
  problem(text: string): string;
  accent(text: string): string;
  bold(text: string): string;
  dim(text: string): string;
}

const unchanged = (text: string): string => text;

/** No styling; used by tests and as the default for formatters. */
export const plainPalette: Palette = {
  ok: unchanged,
  warn: unchanged,
  problem: unchanged,
  accent: unchanged,
  bold: unchanged,
  dim: unchanged,
};

type Style = Parameters<typeof styleText>[0];

// styleText leaves text unstyled when stdout is not a terminal or NO_COLOR is set.
const styled =
  (style: Style) =>
  (text: string): string =>
    styleText(style, text, { stream: process.stdout });

export const terminalPalette: Palette = {
  ok: styled('green'),
  warn: styled('yellow'),
  problem: styled('red'),
  accent: styled('cyan'),
  bold: styled('bold'),
  dim: styled('dim'),
};
