/**
 * cost-source.ts — honest price provenance for cost displays.
 *
 * What the daemon wire actually serves (verified against the SDK snapshot):
 *   - fleet nodes and cost.attribution.get rows carry `costUsd` (null when
 *     unpriced) + `costState` ('priced' | 'estimated' | 'unpriced') — dollars
 *     priced through the one pricing resolver (manual -> provider-served ->
 *     catalog -> honest unknown), but WITHOUT a per-record source stamp.
 *   - the live config's `pricing.modelPrices` table is the manual tier, and a
 *     manual price ALWAYS wins in the resolver — so a model with a manual
 *     entry is priced at "your price", derivable client-side with certainty.
 *   - providers.usage.get exposes a provider-level `pricingSource`
 *     ('catalog' | 'provider' | 'none') for the non-manual tiers. No as-of
 *     date is served anywhere on this wire, so none is ever shown — a dated
 *     label would be fabricated.
 *
 * These helpers turn that into display strings. "price unknown" is the only
 * unpriced rendering — never $0.00.
 */
import { readConfigPath } from './settings-model';
import { readModelPriceTable } from './model-prices';

/** The provider-level pricing source served by providers.usage.get. */
export type ProviderPricingSource = 'catalog' | 'provider' | 'none';

/** Build the manual-price table key for a node/row's provider+model, when both are known. */
export function manualPriceKey(provider: string | undefined, model: string | undefined): string | null {
  if (!provider || !model) return null;
  return `${provider}:${model}`;
}

/** Whether the live config holds a manual price for this provider+model. */
export function hasManualPrice(liveConfig: unknown, provider: string | undefined, model: string | undefined): boolean {
  const key = manualPriceKey(provider, model);
  if (key === null) return false;
  const { value } = readConfigPath(liveConfig, 'pricing.modelPrices');
  return key in readModelPriceTable(value);
}

/**
 * The price-source label for a priced display.
 *   - manual entry in pricing.modelPrices → "your price" (resolver precedence
 *     makes this certain).
 *   - otherwise the provider-level pricingSource: "provider-served price" /
 *     "catalog price". The wire serves no catalog as-of date, so none is shown.
 *   - null when nothing truthful can be said (source unknown / unpriced).
 */
export function priceSourceLabel(
  manual: boolean,
  providerPricingSource: ProviderPricingSource | undefined,
): string | null {
  if (manual) return 'your price';
  if (providerPricingSource === 'provider') return 'provider-served price';
  if (providerPricingSource === 'catalog') return 'catalog price';
  return null;
}

/**
 * Dollar amount rendering shared by cost displays: real dollars where priced,
 * the explicit "price unknown" marker where not — never $0.00 for unpriced.
 */
export function costAmountLabel(costUsd: number | null | undefined, costState: string): string {
  if (costState === 'unpriced' || costUsd == null) {
    return costState === 'estimated' && costUsd != null ? `~$${formatUsd(costUsd)}` : 'price unknown';
  }
  const amount = `$${formatUsd(costUsd)}`;
  return costState === 'estimated' ? `~${amount}` : amount;
}

function formatUsd(costUsd: number): string {
  return costUsd.toFixed(costUsd < 1 ? 4 : 2);
}

/**
 * The unpriced blind spot of an aggregate, stated plainly: how many records
 * contributed no dollars, so a shown total reads as a floor, not the truth.
 * Empty string when there is no blind spot.
 */
export function unpricedBlindSpotLabel(pricedRecordCount: number, unpricedRecordCount: number): string {
  if (!Number.isFinite(unpricedRecordCount) || unpricedRecordCount <= 0) return '';
  const total = unpricedRecordCount + (Number.isFinite(pricedRecordCount) ? Math.max(0, pricedRecordCount) : 0);
  if (pricedRecordCount > 0) {
    return `${unpricedRecordCount} of ${total} records unpriced — dollars shown are a floor`;
  }
  return `all ${unpricedRecordCount} records unpriced`;
}
