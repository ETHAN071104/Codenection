'use client';

import { useState } from 'react';
import { Bot, LoaderCircle, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SystemNotice } from '@/components/ui/system-state';
import { phase2Fetch } from '@/lib/phase2/client';
import type {
  AiEditProposal,
  PlannerMutationResponse,
} from '@/lib/planner/types';

const operationLabels = {
  remove: 'Remove',
  move: 'Move',
  add: 'Add',
  replace: 'Replace',
} as const;

export function AiEditPanel({
  tripId,
  day,
  disabled,
  onApplied,
  onApplyStateChange,
  onClose,
}: {
  tripId: string;
  day: number;
  disabled: boolean;
  onApplied: (result: PlannerMutationResponse) => void;
  onApplyStateChange?: (working: boolean) => void;
  onClose: () => void;
}) {
  const [request, setRequest] = useState('');
  const [proposal, setProposal] = useState<AiEditProposal | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStage, setErrorStage] = useState<'preview' | 'apply'>('preview');

  async function createPreview(event: { preventDefault(): void }) {
    event.preventDefault();
    const cleaned = request.trim();
    if (cleaned.length < 3) return;
    setWorking(true);
    setError(null);
    setProposal(null);
    try {
      const nextProposal = await phase2Fetch<AiEditProposal>(
        `/api/trips/${tripId}/ai-edit/propose`,
        {
          method: 'POST',
          body: JSON.stringify({ request: cleaned, day }),
        },
      );
      setProposal(nextProposal);
    } catch (previewError) {
      setErrorStage('preview');
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'We could not prepare that preview.',
      );
    } finally {
      setWorking(false);
    }
  }

  async function applyChanges() {
    if (!proposal) return;
    setWorking(true);
    onApplyStateChange?.(true);
    setError(null);
    try {
      const result = await phase2Fetch<PlannerMutationResponse>(
        `/api/trips/${tripId}/ai-edit/apply`,
        { method: 'POST', body: JSON.stringify({ proposal }) },
      );
      onApplied(result);
      onClose();
    } catch (applyError) {
      setErrorStage('apply');
      setError(
        applyError instanceof Error
          ? applyError.message
          : 'We could not apply those changes.',
      );
    } finally {
      setWorking(false);
      onApplyStateChange?.(false);
    }
  }

  return (
    <section className="border-b border-warm-border bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Bot className="size-4" aria-hidden="true" />
            AI itinerary edit
          </h3>
          <p className="mt-1 text-xs leading-5 text-warm-muted">
            Preview changes for Day {day} before anything is saved.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close AI editor"
          onClick={onClose}
          className="rounded-lg p-2 text-warm-muted outline-none hover:bg-parchment hover:text-ink focus-visible:ring-2 focus-visible:ring-brown-accent/35"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <form className="mt-4" onSubmit={createPreview}>
        <label htmlFor="ai-edit-request" className="text-xs font-semibold">
          What should change?
        </label>
        <textarea
          id="ai-edit-request"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Make this day more relaxed"
          disabled={disabled || working}
          rows={3}
          className="mt-2 w-full resize-none rounded-xl border border-warm-border bg-parchment p-3 text-sm leading-6 text-ink outline-none placeholder:text-warm-muted/70 focus:border-brown-accent focus:ring-1 focus:ring-brown-accent/20"
        />
        <Button
          type="submit"
          disabled={disabled || working || request.trim().length < 3}
          className="mt-3 h-11 w-full rounded-xl bg-ink text-paper hover:bg-ink/90"
        >
          {working && !proposal ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          Preview changes
        </Button>
      </form>

      {error && (
        <SystemNotice
          role="alert"
          className="mt-3 bg-parchment px-3 py-2.5"
          title={
            errorStage === 'apply'
              ? 'Those changes weren’t applied.'
              : 'We couldn’t prepare a preview.'
          }
          description={
            errorStage === 'apply'
              ? 'Your saved itinerary is unchanged. Try applying the preview again or close it.'
              : 'Your saved itinerary is unchanged. Adjust the request or try previewing it again.'
          }
        />
      )}

      {proposal && (
        <div className="mt-5 border-t border-warm-border pt-4">
          <p className="text-sm font-semibold">{proposal.overview}</p>
          <div className="mt-3 space-y-3">
            {proposal.operations.map((operation) => (
              <div
                key={operation.id}
                className="border-l-2 border-brown-accent pl-3"
              >
                <p className="text-xs font-semibold">
                  {operationLabels[operation.type]}
                  {operation.place ? `: ${operation.place.name}` : ''}
                </p>
                <p className="mt-1 text-xs leading-5 text-warm-muted">
                  {operation.summary}
                </p>
                <p className="mt-1 text-xs leading-5 text-warm-muted">
                  Schedule effect: {operation.expectedEffect}
                </p>
              </div>
            ))}
          </div>
          <Button
            type="button"
            disabled={working}
            onClick={() => void applyChanges()}
            className="mt-4 h-11 w-full rounded-xl bg-ink text-paper hover:bg-ink/90"
          >
            {working && (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            )}
            Apply changes
          </Button>
        </div>
      )}
    </section>
  );
}
