/**
 * KnowledgePacketPanel — build a compact structured knowledge packet for a task
 * and write scope (knowledge.packet), a never-called-before verb this brief
 * adopts. A packet is the packed, budget-aware context an agent would carry into
 * a task — surfacing it here lets an operator preview exactly what an agent
 * would receive before actually running anything.
 */
import { SyntheticEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PackageSearch } from 'lucide-react';
import { invokeMethod } from '../../lib/goodvibes';
import type { OperatorMethodInput } from '../../lib/goodvibes';
import { asRecord, firstArray, firstString, countFrom } from '../../lib/object';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';

type PacketDetail = NonNullable<OperatorMethodInput<'knowledge.packet'>['detail']>;

/**
 * Hand-authored: the installed `@pellux/goodvibes-sdk` contracts package (1.1.0) predates
 * these fields — the SDK added them post-1.2.0 (packet.ts's `truncated` / `totalCandidates` /
 * `droppedCount`, "a partial packet must never read as complete"). All three are OPTIONAL
 * here because they are additive on the wire: an older daemon simply omits them, and this
 * view must keep rendering that daemon's response exactly as it always has — no fabricated
 * claim. Once the webui pins a contracts package whose `OperatorMethodOutput<'knowledge.packet'>`
 * carries these, this local type can be dropped for the generated one.
 */
interface KnowledgePacketTruncation {
  readonly totalCandidates: number;
  readonly droppedCount: number;
}

/** Only a genuinely truncated, post-1.2.0-daemon response yields a disclosure — a daemon
 * that never sends `truncated`/`totalCandidates`/`droppedCount` renders exactly as it did
 * before these fields existed, matching FleetView.tsx's `snapshot.data.truncated` cap-note. */
function truncationInfo(data: unknown): KnowledgePacketTruncation | null {
  const record = asRecord(data);
  if (record.truncated !== true) return null;
  const totalCandidates = record.totalCandidates;
  const droppedCount = record.droppedCount;
  if (typeof totalCandidates !== 'number' || typeof droppedCount !== 'number') return null;
  return { totalCandidates, droppedCount };
}

function splitScope(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function KnowledgePacketPanel() {
  const [task, setTask] = useState('');
  const [writeScope, setWriteScope] = useState('');
  const [detail, setDetail] = useState<PacketDetail>('standard');
  const [budgetLimit, setBudgetLimit] = useState('');

  const packet = useMutation({
    mutationFn: () => {
      const scope = splitScope(writeScope);
      const budget = Number(budgetLimit);
      return invokeMethod('knowledge.packet', {
        task: task.trim(),
        detail,
        ...(scope.length ? { writeScope: scope } : {}),
        ...(budgetLimit.trim() && Number.isFinite(budget) && budget > 0 ? { budgetLimit: budget } : {}),
      });
    },
  });

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (task.trim()) packet.mutate();
  }

  const items = firstArray(packet.data, ['items']);
  const estimatedTokens = countFrom(packet.data, ['estimatedTokens']);
  const truncation = truncationInfo(packet.data);

  return (
    <div className="knowledge-packet">
      <form className="form-grid" onSubmit={submit}>
        <label>
          Task
          <input
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="Describe the task this packet is for"
            aria-label="Task description"
          />
        </label>
        <div className="form-split">
          <label>
            Detail
            <select value={detail} onChange={(event) => setDetail(event.target.value as PacketDetail)} aria-label="Packet detail level">
              <option value="compact">Compact</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label>
            Budget (tokens)
            <input
              value={budgetLimit}
              onChange={(event) => setBudgetLimit(event.target.value)}
              placeholder="Optional"
              inputMode="numeric"
              aria-label="Token budget limit"
            />
          </label>
        </div>
        <label>
          Write scope
          <input
            value={writeScope}
            onChange={(event) => setWriteScope(event.target.value)}
            placeholder="Comma-separated paths, optional"
            aria-label="Write scope, comma separated"
          />
        </label>
        <button className="primary-button" type="submit" disabled={packet.isPending || !task.trim()} aria-busy={packet.isPending}>
          {packet.isPending ? 'Building…' : 'Build Packet'}
        </button>
      </form>

      {packet.error ? (
        <ErrorState error={packet.error} onRetry={() => { if (task.trim()) packet.mutate(); }} title="Packet build failed" />
      ) : packet.data ? (
        items.length === 0 ? (
          <EmptyState
            icon={<PackageSearch size={24} aria-hidden="true" />}
            title="Packet has no items"
            description="Nothing in the knowledge base matched this task within the given budget."
          />
        ) : (
          <div className="knowledge-packet__result">
            <p className="knowledge-packet__summary">
              {items.length} item{items.length === 1 ? '' : 's'} · ~{estimatedTokens} estimated tokens
            </p>
            {truncation && (
              <p className="knowledge-packet__truncation-note" role="note">
                Showing {items.length} of {truncation.totalCandidates} candidates ({truncation.droppedCount} dropped).
              </p>
            )}
            <ul className="knowledge-packet__items">
              {items.map((item, index) => {
                const kind = firstString(item, ['kind']) || 'item';
                const title = firstString(item, ['title']) || firstString(item, ['id']) || `Item ${index + 1}`;
                const reason = firstString(item, ['reason']);
                const score = countFrom(item, ['score']);
                return (
                  <li key={firstString(item, ['id']) || index}>
                    <div className="knowledge-packet__item-head">
                      <span className="knowledge-packet__item-kind">{kind}</span>
                      <span className="knowledge-packet__item-score">{score.toFixed(2)}</span>
                    </div>
                    <strong>{title}</strong>
                    {reason && <span className="knowledge-packet__item-reason">{reason}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}
