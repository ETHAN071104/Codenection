import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plane } from 'lucide-react';

const JOURNEY_STEPS = ['Preferences', 'Places', 'Plan', 'Ready'] as const;

export function JourneyShell({
  tripId,
  children,
  currentStep = 'Preferences',
  contentAlign = 'center',
}: {
  tripId: string;
  children: ReactNode;
  currentStep?: (typeof JOURNEY_STEPS)[number];
  contentAlign?: 'center' | 'start';
}) {
  const currentIndex = JOURNEY_STEPS.indexOf(currentStep);

  return (
    <main className="min-h-[100dvh] bg-parchment text-ink">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1180px] flex-col px-5 pb-14 pt-5 sm:px-8 sm:pb-20 lg:px-12">
        <header className="grid min-h-16 items-center gap-5 border-b border-warm-border py-3 md:grid-cols-[1fr_auto_1fr]">
          <Link
            href={`/trip/${tripId}`}
            className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-ink transition-colors hover:text-brown-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Trip room
          </Link>

          <nav
            aria-label="Trip planning progress"
            className="order-3 md:order-none"
          >
            <ol className="grid grid-cols-4 gap-2 sm:gap-4">
              {JOURNEY_STEPS.map((step, index) => {
                const active = index === currentIndex;
                const complete = index < currentIndex;
                return (
                  <li
                    key={step}
                    aria-current={active ? 'step' : undefined}
                    className={`min-w-14 border-b pb-2 text-center text-[0.65rem] font-semibold uppercase tracking-[0.14em] sm:min-w-20 sm:text-xs ${
                      active
                        ? 'border-ink text-ink'
                        : complete
                          ? 'border-brown-accent text-brown-accent'
                          : 'border-warm-border text-warm-muted/55'
                    }`}
                  >
                    {step}
                  </li>
                );
              })}
            </ol>
          </nav>

          <Link
            href="/"
            className="hidden justify-self-end text-xs font-semibold uppercase tracking-[0.16em] text-warm-muted transition-colors hover:text-ink md:inline-flex md:items-center md:gap-2"
          >
            <Plane className="size-3.5" aria-hidden="true" />
            Travel Planner
          </Link>
        </header>

        <div
          className={`flex flex-1 py-10 sm:py-14 lg:py-20 ${
            contentAlign === 'start' ? 'items-start' : 'items-center'
          }`}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
