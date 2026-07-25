/**
 * ToolActivityGroup — folds a completed turn's tool calls into the assistant
 * message that produced them, instead of letting them evaporate once the turn
 * ends (see useChatStream's toolActivityByMessageId doc comment for where the
 * data comes from and why it is only ever present for a turn this browser tab
 * watched run live).
 *
 * Single-tool turns render one compact entry directly. Multi-tool turns fold
 * behind a <details>/<summary> disclosure — the same idiom MessageItem already
 * uses for compaction-handoff messages — with a real, counted summary line
 * ("3 tools · read×2, exec — expand"), never an invented total.
 */
import {
  toolFriendlyLabel,
  summarizeToolActivity,
  toolKeyArg,
  toolResultText,
  type CompletedToolCall,
} from './message-utils';

/** Results longer than this render a truncated preview with the full text behind expand. */
const RESULT_PREVIEW_LIMIT = 240;

function ToolActivityEntry({ call }: { call: CompletedToolCall }) {
  const label = toolFriendlyLabel(call.toolName);
  const keyArg = toolKeyArg(call.toolInput);
  const resultText = toolResultText(call.result);
  const isTruncated = resultText.length > RESULT_PREVIEW_LIMIT;
  const preview = isTruncated ? `${resultText.slice(0, RESULT_PREVIEW_LIMIT)}…` : resultText;

  return (
    <li className={`message-tool-activity__item${call.isError ? ' message-tool-activity__item--error' : ''}`}>
      <div className="message-tool-activity__header">
        <span className="message-tool-activity__label">{label}</span>
        {keyArg && <span className="message-tool-activity__arg" title={keyArg}>{keyArg}</span>}
        {call.isError && <span className="message-tool-activity__error-badge">error</span>}
      </div>
      {resultText && (
        isTruncated ? (
          <details className="message-tool-activity__result">
            <summary>{preview}</summary>
            <pre>{resultText}</pre>
          </details>
        ) : (
          <pre className="message-tool-activity__result-inline">{resultText}</pre>
        )
      )}
    </li>
  );
}

export function ToolActivityGroup({ toolActivity }: { toolActivity: readonly CompletedToolCall[] }) {
  if (toolActivity.length === 0) return null;

  if (toolActivity.length === 1) {
    return (
      <ul className="message-tool-activity message-tool-activity--single" aria-label="Tool call result">
        <ToolActivityEntry call={toolActivity[0]} />
      </ul>
    );
  }

  return (
    <details className="message-tool-activity message-tool-activity--group">
      <summary>{toolActivity.length} tools · {summarizeToolActivity(toolActivity)} — expand</summary>
      <ul className="message-tool-activity__list">
        {toolActivity.map((call) => <ToolActivityEntry key={call.toolCallId} call={call} />)}
      </ul>
    </details>
  );
}
