'use client';

import { useState } from 'react';
import { Bot, LoaderCircle, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <section className="border-b border-[#35383d]/25 bg-[#fffdf8] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Bot className="size-4" aria-hidden="true" />
            AI itinerary edit
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#5a5d61]">
            Preview changes for Day {day} before anything is saved.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close AI editor"
          onClick={onClose}
          className="p-1 text-[#5a5d61] outline-none hover:text-[#25282d] focus-visible:ring-2 focus-visible:ring-[#2f3237]"
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
          className="mt-2 w-full resize-none border border-[#35383d]/35 bg-[#f7f3e8] p-3 text-sm leading-6 text-[#25282d] outline-none placeholder:text-[#5a5d61] focus:border-[#2f3237] focus:ring-1 focus:ring-[#2f3237]"
        />
        <Button
          type="submit"
          disabled={disabled || working || request.trim().length < 3}
          className="mt-3 h-10 w-full rounded-none bg-[#2f3237] text-[#f8f4e8] hover:bg-[#1f2227]"
        >
          {working && !proposal ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          Preview Changes
        </Button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-brown-accent/25 bg-parchment px-3 py-2 text-xs leading-5 text-ink"
        >
          {error}
        </p>
      )}

      {proposal && (
        <div className="mt-5 border-t border-[#35383d]/25 pt-4">
          <p className="text-sm font-semibold">{proposal.overview}</p>
          <div className="mt-3 space-y-3">
            {proposal.operations.map((operation) => (
              <div
                key={operation.id}
                className="border-l-2 border-[#2f3237] pl-3"
              >
                <p className="text-xs font-semibold">
                  {operationLabels[operation.type]}
                  {operation.place ? `: ${operation.place.name}` : ''}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#5a5d61]">
                  {operation.summary}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#5a5d61]">
                  Schedule effect: {operation.expectedEffect}
                </p>
              </div>
            ))}
          </div>
          <Button
            type="button"
            disabled={working}
            onClick={() => void applyChanges()}
            className="mt-4 h-10 w-full rounded-none bg-[#2f3237] text-[#f8f4e8] hover:bg-[#1f2227]"
          >
            {working && (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            )}
            Apply Changes
          </Button>
        </div>
      )}
    </section>
  );
}
