import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plane } from 'lucide-react';

function MapLineDecoration() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-[#4b4f54]"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M-80 168C126 126 255 214 421 179S719 68 911 123s286 13 609-89" />
        <path d="M-64 638c174-80 284-48 419 17s248 66 392 10 319-42 486 36 255 64 334 23" />
        <path d="M164-52c42 132 14 263-42 370s-36 242 44 351 79 186 18 290" />
        <path d="M1180-56c-68 137-28 249 46 352s85 207 27 328-51 216 13 326" />
        <path d="M710-40c-9 150 50 235 135 314s93 173 13 252-143 175-87 374" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.72">
        <path d="m318 262 96-48 89 19 42 83-67 71-118-12-42-113Z" />
        <path d="m922 448 142-72 128 28 36 102-84 87-146-22-76-123Z" />
        <path d="m508 606 109-42 101 50-19 108-131 18-60-134Z" />
        <path d="M43 442h286M1012 208h373M729 317h360M267 783h302" />
        <path d="M384 214v161M503 233v154M998 406v165M1144 404v189M568 565v175M699 614v108" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="3" opacity="0.22">
        <path d="M-30 530c215-37 327-31 461 33s241 58 350 3 211-76 359-22 226 58 340 18" />
      </g>
    </svg>
  );
}

export function AtlasShell({
  tripId,
  children,
  step,
  sectionLabel = 'TRAVEL DNA',
}: {
  tripId: string;
  children: ReactNode;
  step?: number;
  sectionLabel?: string;
}) {
  return (
    <main className="atlas-page relative min-h-[100dvh] overflow-hidden bg-[#f2eee1] text-[#25282d]">
      <div className="absolute inset-0 opacity-[0.14]">
        <MapLineDecoration />
      </div>
      <div className="atlas-paper-noise pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1400px] flex-col px-4 py-5 sm:px-8 sm:py-7 lg:px-12">
        <header className="flex min-h-14 items-center justify-between border-b border-[#35383d]/30">
          <Link
            href={`/trip/${tripId}`}
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] outline-none transition-opacity hover:opacity-65 focus-visible:ring-2 focus-visible:ring-[#2f3237] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f2eee1]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Trip room
          </Link>

          <div className="flex items-center gap-2 text-sm font-semibold tracking-[0.08em]">
            <Plane className="size-4" aria-hidden="true" />
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
                  className={`h-1.5 w-5 border border-[#2f3237] transition-colors ${
                    item <= step ? 'bg-[#2f3237]' : 'bg-transparent'
                  }`}
                />
              ))}
              <span className="sr-only">{step} of 3</span>
            </div>
          ) : (
            <span className="w-[70px]" aria-hidden="true" />
          )}
        </header>

        <div className="flex flex-1 items-center py-10 sm:py-14">
          {children}
        </div>
      </div>
    </main>
  );
}
