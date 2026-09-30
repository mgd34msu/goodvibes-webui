/**
 * Temporary section switch at the top of Work, Library and Personal. Until the
 * later phases build those views, each destination is a group of existing
 * views; this segmented control keeps every one of them one click away.
 */
import type { ViewId } from '../../lib/router';
import { Segmented } from '../ui/Segmented';
import { destinationById, destinationOf } from './nav';

export function DestinationTabs({ view, onNavigate }: { view: ViewId; onNavigate: (view: ViewId) => void }) {
  const destination = destinationById(destinationOf(view));
  if (!destination || destination.tabs.length < 2) return null;
  return (
    <div className="shell-destination-tabs">
      <Segmented
        label={`${destination.label} sections`}
        value={view}
        options={destination.tabs.map((tab) => ({ value: tab.view, label: tab.label }))}
        onChange={onNavigate}
      />
    </div>
  );
}
