import type { ComponentProps, ReactNode } from 'react';

// Small building blocks shared by the page's sections, so each look is defined once.

/** A bordered card. */
export function Panel({ className = '', ...props }: ComponentProps<'section'>) {
  return <section className={`mb-4 rounded-lg border border-line bg-surface p-4 ${className}`} {...props} />;
}

/** Secondary explanatory text. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

/** A small uppercase heading for a section inside a report. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <h4 className="mt-5 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h4>;
}

const MESSAGE_TONE = {
  busy: 'border-l-accent',
  ok: 'border-l-ok',
  notice: 'border-l-warn',
  problem: 'border-l-problem text-problem',
};

/** A status line: work in progress, a result, or a problem (announced as an alert). */
export function Message({ tone, children }: { tone: keyof typeof MESSAGE_TONE; children: ReactNode }) {
  return (
    <div
      data-tone={tone}
      role={tone === 'problem' ? 'alert' : 'status'}
      className={`mt-3 rounded border-l-4 bg-page px-3 py-2 wrap-anywhere ${MESSAGE_TONE[tone]}`}
    >
      {children}
    </div>
  );
}

interface ButtonProps extends ComponentProps<'button'> {
  /** The main action. */
  primary?: boolean;
  /** An action that deletes something. */
  danger?: boolean;
}

/** A button sized for touch. */
export function Button({ primary = false, danger = false, className = '', ...props }: ButtonProps) {
  const look = primary
    ? 'border-accent bg-accent font-semibold text-surface'
    : danger
      ? 'border-problem bg-surface text-problem'
      : 'border-line bg-surface';
  return (
    <button
      type="button"
      className={`min-h-11 cursor-pointer rounded-md border px-4 py-2 disabled:cursor-not-allowed disabled:opacity-55 ${look} ${className}`}
      {...props}
    />
  );
}

/** A link that opens the original source in a new tab. */
export function ExternalLink({ className = 'text-accent underline', ...props }: ComponentProps<'a'>) {
  return <a target="_blank" rel="noreferrer" className={className} {...props} />;
}

/** A collapsible section with a bold, clickable title. */
export function Disclosure({ title, children, ...props }: { title: ReactNode } & Omit<ComponentProps<'details'>, 'title'>) {
  return (
    <details className="mt-3" {...props}>
      <summary className="cursor-pointer py-1 font-semibold">{title}</summary>
      {children}
    </details>
  );
}
