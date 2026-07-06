interface StatusBadgeProps {
  value: string;
}

export function StatusBadge({ value }: StatusBadgeProps) {
  const normalized = value.toLowerCase();
  // Provider auth freshness labels (src/lib/provider-status.ts) are part of
  // this vocabulary: 'expired' is a bad state (credentials no longer work),
  // 'expiring' a warning (still working, needs attention). 'unconfigured'
  // and 'status unavailable' intentionally fall through to neutral — neither
  // is a fault, they are honest absent/not-set-up states.
  const tone = normalized.includes('error') || normalized.includes('fail') || normalized.includes('denied') || normalized.includes('expired')
    ? 'bad'
    : normalized.includes('warn') || normalized.includes('pending') || normalized.includes('blocked') || normalized.includes('expiring')
      ? 'warning'
      : normalized.includes('healthy') || normalized.includes('ok') || normalized.includes('ready') || normalized.includes('active')
        ? 'ok'
        : 'neutral';

  return <span className={`badge ${tone}`}>{value}</span>;
}
