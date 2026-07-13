/**
 * PriceSourceNote — the provenance line under a dollar display: whose price
 * produced the number, stated only when the wire can back it.
 *
 *   - "your price"            — the live config holds a manual entry for this
 *                               provider:model (manual tier always wins in the
 *                               resolver, so this is certain).
 *   - "provider-served price" / "catalog price" — the provider-level
 *                               pricingSource from providers.usage.get. The
 *                               wire serves no catalog as-of date, so none is
 *                               shown — a date here would be fabricated.
 *   - "price source unknown"  — nothing truthful available.
 *
 * Always offers the one-action path into manual-price editing, seeded with
 * this display's provider:model key.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sdk } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { asRecord } from '../../lib/object';
import {
  hasManualPrice,
  manualPriceKey,
  priceSourceLabel,
  type ProviderPricingSource,
} from '../../lib/cost-source';
import { ModelPricesModal } from './ModelPricesModal';
import '../../styles/components/pricing.css';

export interface PriceSourceNoteProps {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  /** Whether the display this note annotates shows a priced dollar amount. */
  readonly priced: boolean;
}

function readProviderPricingSource(usage: unknown): ProviderPricingSource | undefined {
  const source = asRecord(usage).pricingSource;
  return source === 'catalog' || source === 'provider' || source === 'none' ? source : undefined;
}

export function PriceSourceNote({ provider, model, priced }: PriceSourceNoteProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const config = useQuery({
    queryKey: queryKeys.config,
    queryFn: () => sdk.operator.config.get(),
    retry: false,
  });
  const manual = !config.isError && hasManualPrice(config.data, provider, model);
  const usage = useQuery({
    queryKey: ['providers', provider ?? '', 'usage'],
    // Only consulted for the non-manual tiers of a PRICED display.
    enabled: Boolean(provider) && priced && !manual,
    retry: false,
    queryFn: () => sdk.operator.providers.usage(provider ?? ''),
  });

  const sourceText = priced
    ? (priceSourceLabel(manual, usage.isError ? undefined : readProviderPricingSource(usage.data)) ??
      (usage.isPending && Boolean(provider) ? null : 'price source unknown'))
    : null;
  const modelKey = manualPriceKey(provider, model);

  return (
    <span className="price-source-note" data-testid="price-source-note">
      {sourceText && <span className="price-source-note__label">{sourceText}</span>}
      <button
        type="button"
        className="link-button price-source-note__edit"
        onClick={() => setEditorOpen(true)}
      >
        {manual ? 'Edit price' : 'Set price'}
      </button>
      {/* Mounted only while open, so a closed note stays inert (no toast/query
          context needed until the user actually reaches for the editor). */}
      {editorOpen && (
        <ModelPricesModal
          open
          onClose={() => setEditorOpen(false)}
          {...(modelKey && !manual ? { initialModelKey: modelKey } : {})}
        />
      )}
    </span>
  );
}
