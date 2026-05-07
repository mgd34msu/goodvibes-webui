interface StatusBadgeProps {
  value: string;
}

export function StatusBadge({ value }: StatusBadgeProps) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes('error') || normalized.includes('fail') || normalized.includes('denied')
    ? 'bad'
    : normalized.includes('warn') || normalized.includes('pending') || normalized.includes('blocked')
      ? 'warning'
      : normalized.includes('healthy') || normalized.includes('ok') || normalized.includes('ready') || normalized.includes('active')
        ? 'ok'
        : 'neutral';

  return <span className={`badge ${tone}`}>{value}</span>;
}
