import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plane } from 'lucide-react';

export function AtlasShell({
  tripId,
  children,
  step,
  sectionLabel = 'TRAVEL DNA',
  variant = 'default',
}: {
  tripId: string;
  children: ReactNode;
  step?: number;
  sectionLabel?: string;
  variant?: 'default' | 'travel-dna';
}) {
  return (
    <main
      data-shell-variant={variant}
      className="atlas-page relative min-h-[100dvh] overflow-hidden bg-parchment text-ink"
    >
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1180px] flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12">
        <header className="flex min-h-14 items-center justify-between border-b border-warm-border">
          <Link
            href={`/trip/${tripId}`}
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-ink outline-none transition-colors hover:text-brown-accent focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Trip room
          </Link>

          <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] sm:text-sm">
            <Plane className="size-4 text-brown-accent" aria-hidden="true" />
            {sectionLabel}
          </div>

          {step ? (
            <div
              className="flex items-center gap-1.5"
              aria-label={`Question ${step} of 3`}
            >
              {[1, 2, 3].map((item) => (
                <span
                  key={item}
                  className={`h-1.5 w-5 rounded-full border transition-colors ${
                    item <= step
                      ? 'border-brown-accent bg-brown-accent'
                      : 'border-warm-border bg-transparent'
                  }`}
                />
              ))}
              <span className="sr-only">{step} of 3</span>
            </div>
          ) : (
            <span className="w-[70px]" aria-hidden="true" />
          )}
        </header>

        <div className="flex flex-1 items-center py-8 sm:py-12 lg:py-16">
          {children}
        </div>
      </div>
    </main>
  );
}
