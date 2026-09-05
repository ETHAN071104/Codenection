import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function SystemLoading({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className={cn(
        'mx-auto w-full max-w-xl rounded-2xl border border-warm-border bg-paper p-7 shadow-editorial sm:p-9',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="h-1.5 w-14 rounded-full bg-brown-accent/55 motion-safe:animate-pulse"
      />
      <h1 className="mt-5 font-editorial text-3xl font-medium tracking-[-0.035em] text-ink">
        {title}
      </h1>
      {description && (
        <p className="mt-3 max-w-md text-sm leading-6 text-warm-muted">
          {description}
        </p>
      )}
      <div className="mt-7 space-y-3" aria-hidden="true">
        <div className="h-3 w-4/5 rounded-full bg-parchment motion-safe:animate-pulse" />
        <div className="h-3 w-3/5 rounded-full bg-parchment motion-safe:animate-pulse" />
        <div className="h-12 w-full rounded-xl bg-parchment motion-safe:animate-pulse" />
      </div>
    </section>
  );
}

export function SystemState({
  eyebrow,
  title,
  description,
  actions,
  icon,
  role = 'status',
  className,
}: {
  eyebrow?: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  role?: 'status' | 'alert';
  className?: string;
}) {
  return (
    <section
      role={role}
      className={cn(
        'mx-auto w-full max-w-xl rounded-2xl border border-warm-border bg-paper p-7 shadow-editorial sm:p-9',
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {icon && (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-parchment text-brown-accent">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-[0.17em] text-brown-accent">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              'font-editorial text-3xl font-medium leading-[1.05] tracking-[-0.04em] text-ink sm:text-4xl',
              eyebrow && 'mt-3',
            )}
          >
            {title}
          </h1>
          <div className="mt-4 text-sm leading-6 text-warm-muted sm:text-base sm:leading-7">
            {description}
          </div>
        </div>
      </div>
      {actions && (
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {actions}
        </div>
      )}
    </section>
  );
}
