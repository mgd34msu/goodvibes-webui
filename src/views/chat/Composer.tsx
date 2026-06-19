import { ChangeEvent, FormEvent, KeyboardEvent, RefObject } from 'react';
import { Mic, Paperclip, Send, X } from 'lucide-react';
import { formatError } from '../../lib/errors';
import { ModelOption, ProviderOption } from '../../lib/provider-models';

interface ComposerProps {
  draft: string;
  attachedFiles: File[];
  isSendPending: boolean;
  sendError: unknown;
  turnError: string;
  renameSessionError: unknown;
  selectModelError: unknown;
  providerOptions: ProviderOption[];
  selectedProviderId: string;
  providerModelOptions: ModelOption[];
  selectedModelRegistryKey: string;
  selectModelPending: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDraftChange: (value: string) => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent) => void;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachedFile: (index: number) => void;
  onProviderChange: (providerId: string) => void;
  onModelChange: (registryKey: string) => void;
}

export function Composer({
  draft,
  attachedFiles,
  isSendPending,
  sendError,
  turnError,
  renameSessionError,
  selectModelError,
  providerOptions,
  selectedProviderId,
  providerModelOptions,
  selectedModelRegistryKey,
  selectModelPending,
  composerRef,
  fileInputRef,
  onDraftChange,
  onComposerKeyDown,
  onSubmit,
  onFileSelection,
  onRemoveAttachedFile,
  onProviderChange,
  onModelChange,
}: ComposerProps) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      {Boolean(sendError) && <div className="composer-error">{formatError(sendError)}</div>}
      {turnError && <div className="composer-error">{turnError}</div>}
      {Boolean(renameSessionError) && <div className="composer-error">{formatError(renameSessionError)}</div>}
      {Boolean(selectModelError) && <div className="composer-error">{formatError(selectModelError)}</div>}
      {attachedFiles.length > 0 && (
        <div className="composer-attachments">
          {attachedFiles.map((file, index) => (
            <span key={`${file.name}-${file.lastModified}-${index}`} className="composer-attachment">
              <Paperclip size={13} />
              {file.name}
              <button type="button" title={`Remove ${file.name}`} onClick={() => onRemoveAttachedFile(index)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-box">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder="Message GoodVibes"
          aria-label="Message GoodVibes"
          rows={1}
        />
        <input ref={fileInputRef} type="file" hidden multiple onChange={onFileSelection} />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              type="button"
              className="composer-tool"
              title="Attach files"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSendPending}
            >
              <Paperclip size={16} />
            </button>
            <button
              type="button"
              className="composer-tool"
              title="Voice mode is not available in this WebUI build"
              disabled
            >
              <Mic size={16} />
            </button>
          </div>
          <div className="composer-route">
            <select
              value={selectedProviderId}
              onChange={(event) => onProviderChange(event.target.value)}
              disabled={!providerOptions.length}
              aria-label="Provider"
            >
              {!providerOptions.length && <option value="">Provider</option>}
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
            <select
              value={selectedModelRegistryKey}
              onChange={(event) => event.target.value && onModelChange(event.target.value)}
              disabled={!providerModelOptions.length || selectModelPending}
              aria-label="Model"
            >
              <option value="">{providerModelOptions.length ? 'Model' : 'No models'}</option>
              {providerModelOptions.map((model) => (
                <option key={model.registryKey} value={model.registryKey}>{model.label}</option>
              ))}
            </select>
          </div>
          <div className="composer-actions">
            <button
              type="submit"
              className="send-button"
              title="Send message"
              disabled={isSendPending || (!draft.trim() && !attachedFiles.length)}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
