import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ChevronDown, Check, Mic, Paperclip, Send, X } from 'lucide-react';
import { formatError } from '../../lib/errors';
import { ModelOption, ProviderOption } from '../../lib/provider-models';
import { dragHasFiles, filesFromDrop, imageFilesFromPaste, isImageFile, previewUrl } from './composer-attachments';
import '../../styles/components/chat-composer.css';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A slash-command hint entry shown when the draft starts with "/". */
export interface SlashCommandHint {
  name: string;
  description: string;
}

export interface ComposerProps {
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
  /**
   * Optional list of slash-command hints shown when the user types "/" at the
   * start of the composer. Defaults to empty — no menu.
   */
  slashCommands?: readonly SlashCommandHint[];
  /**
   * Optional callback invoked when files are added via drag-and-drop or
   * clipboard paste. When provided, DnD/paste routes files directly here
   * instead of synthesising a native input change event.
   *
   * Integration: wire this to the chat file handler so DnD/paste activate
   * at the ChatView level without needing a hidden-input workaround.
   *
   * The hidden-input native onChange (fileInputRef) is still used for
   * click-to-attach so ChatView compiles unchanged when this prop is absent.
   */
  onFilesAdded?: (files: File[]) => void;
}

// ─── Attachment chip ──────────────────────────────────────────────────────────

interface AttachmentChipProps {
  file: File;
  index: number;
  onRemove: (index: number) => void;
}

function AttachmentChip({ file, index, onRemove }: AttachmentChipProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImageFile(file)) return;
    const url = previewUrl(file);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <span
      key={`${file.name}-${file.lastModified}-${index}`}
      className="composer-attachment"
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          aria-hidden
          className="composer-attachment-thumb"
        />
      ) : (
        <Paperclip size={13} aria-hidden />
      )}
      <span className="composer-attachment-name">{file.name}</span>
      <button
        type="button"
        title={`Remove ${file.name}`}
        aria-label={`Remove attachment ${file.name}`}
        onClick={() => onRemove(index)}
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  );
}

// ─── Model picker popover ─────────────────────────────────────────────────────

interface ModelPickerProps {
  providerOptions: ProviderOption[];
  selectedProviderId: string;
  providerModelOptions: ModelOption[];
  selectedModelRegistryKey: string;
  selectModelPending: boolean;
  onProviderChange: (providerId: string) => void;
  onModelChange: (registryKey: string) => void;
}

function ModelPicker({
  providerOptions,
  selectedProviderId,
  providerModelOptions,
  selectedModelRegistryKey,
  selectModelPending,
  onProviderChange,
  onModelChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (trigger?.contains(event.target as Node)) return;
      if (popover?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectedModel = providerModelOptions.find(
    (m) => m.registryKey === selectedModelRegistryKey,
  );
  const triggerLabel = selectModelPending
    ? 'Switching…'
    : selectedModel?.label ?? (providerModelOptions.length ? 'Select model' : 'No models');

  // Build a flat list of model items with stable ids for aria-activedescendant.
  // Provider rows are rendered as non-interactive group headers (not options).
  const modelItems: { model: ModelOption; optionId: string }[] = [];
  let modelIndexCounter = 0;
  for (const provider of providerOptions) {
    if (provider.id === selectedProviderId) {
      for (const model of providerModelOptions) {
        modelItems.push({
          model,
          optionId: `${popoverId}-opt-${modelIndexCounter}`,
        });
        modelIndexCounter++;
      }
    }
  }

  const activeOptionId =
    activeIndex >= 0 && modelItems[activeIndex]
      ? modelItems[activeIndex].optionId
      : undefined;

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
      } else {
        const dir = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((i) => Math.max(0, Math.min(modelItems.length - 1, i + dir)));
      }
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen((prev) => !prev);
    }
  }

  function handlePopoverKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(modelItems.length - 1, i + 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    }
    if (event.key === 'Enter' && activeIndex >= 0 && modelItems[activeIndex]) {
      event.preventDefault();
      const item = modelItems[activeIndex];
      onModelChange(item.model.registryKey);
      setOpen(false);
      triggerRef.current?.focus();
    }
    if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  // Build a model-index lookup for rendering data-active on the correct button.
  // We iterate providerOptions and track which flat model index each model slot is.
  let renderModelCounter = 0;

  return (
    <div className="composer-route" style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        className="composer-model-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`Model: ${triggerLabel}`}
        data-pending={selectModelPending ? 'true' : undefined}
        disabled={!providerOptions.length}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="composer-model-label">{triggerLabel}</span>
        <ChevronDown size={12} aria-hidden />
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="listbox"
          aria-label="Select model"
          aria-activedescendant={activeOptionId}
          className="composer-model-popover"
          tabIndex={-1}
          onKeyDown={handlePopoverKeyDown}
        >
          {providerOptions.map((provider) => {
            const isExpanded = provider.id === selectedProviderId;
            return (
              <div key={provider.id} className="composer-model-popover-section">
                {/* Provider header — group label; the button is keyboard-reachable (Tab) */}
                <div
                  role="group"
                  aria-label={provider.label}
                  className="composer-model-provider-header"
                >
                  <button
                    type="button"
                    className="composer-model-option composer-model-provider-btn"
                    onClick={() => {
                      onProviderChange(provider.id);
                      setActiveIndex(-1);
                    }}
                  >
                    <span className="composer-model-section-label" style={{ padding: 0 }}>
                      {provider.label}
                    </span>
                  </button>
                </div>
                {isExpanded &&
                  providerModelOptions.map((model) => {
                    const myIndex = renderModelCounter++;
                    const { optionId } = modelItems[myIndex];
                    const isActive = myIndex === activeIndex;
                    return (
                      <button
                        key={model.registryKey}
                        id={optionId}
                        type="button"
                        role="option"
                        aria-selected={model.registryKey === selectedModelRegistryKey}
                        data-active={isActive ? 'true' : undefined}
                        className="composer-model-option"
                        onClick={() => {
                          onModelChange(model.registryKey);
                          setOpen(false);
                          triggerRef.current?.focus();
                        }}
                      >
                        <span className="composer-model-option-label">{model.label}</span>
                        {model.registryKey === selectedModelRegistryKey && (
                          <Check size={14} className="composer-model-option-check" aria-hidden />
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Slash-command menu ───────────────────────────────────────────────────────

interface SlashMenuProps {
  /** Pre-filtered commands — parent is the single source of truth. */
  commands: readonly SlashCommandHint[];
  activeIndex: number;
  onSelect: (name: string) => void;
  menuId: string;
  /** Base id prefix for option elements (enables aria-activedescendant). */
  optionIdPrefix: string;
}

function SlashMenu({ commands, activeIndex, onSelect, menuId, optionIdPrefix }: SlashMenuProps) {
  if (!commands.length) return null;

  return (
    <div
      id={menuId}
      role="listbox"
      aria-label="Slash commands"
      className="composer-slash-menu"
    >
      <div className="composer-slash-menu-label">Commands</div>
      {commands.map((cmd, i) => (
        <button
          key={cmd.name}
          id={`${optionIdPrefix}-${i}`}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className="composer-slash-item"
          onMouseDown={(e) => {
            // Prevent textarea blur
            e.preventDefault();
            onSelect(cmd.name);
          }}
        >
          <span className="composer-slash-item-name">/{cmd.name}</span>
          <span className="composer-slash-item-desc">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Composer ─────────────────────────────────────────────────────────────────

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
  slashCommands = [],
  onFilesAdded,
}: ComposerProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  // When true, the slash menu is suppressed for the current draft value.
  // Resets automatically when the draft changes to a non-slash or empty string.
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashMenuId = useId();
  const slashOptionIdPrefix = `${slashMenuId}-opt`;

  const showSlashMenu =
    !slashDismissed &&
    slashCommands.length > 0 &&
    draft.startsWith('/') &&
    !draft.includes(' ');

  const filteredSlashCommands = showSlashMenu
    ? draft.length > 1
      ? slashCommands.filter((cmd) =>
          cmd.name.toLowerCase().startsWith(draft.slice(1).toLowerCase()),
        )
      : slashCommands
    : [];

  // Reset slash selection when filtered list changes
  useEffect(() => {
    setSlashActiveIndex(0);
  }, [filteredSlashCommands.length]);

  // Reset dismissed flag when draft changes out of slash territory
  useEffect(() => {
    if (!draft.startsWith('/') || draft.includes(' ')) {
      setSlashDismissed(false);
    }
  }, [draft]);

  // ── Drag-and-drop ──────────────────────────────────────────────────────────

  const handleDragOver = useCallback((event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dragHasFiles(event.nativeEvent)) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLFormElement>) => {
    // Only clear when leaving the form element entirely
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      const files = filesFromDrop(event.nativeEvent);
      if (!files.length) return;
      if (onFilesAdded) {
        // Typed callback path — no synthetic events needed.
        onFilesAdded(files);
      } else {
        // Fallback: push files into the hidden input so native onChange fires.
        const dt = new DataTransfer();
        for (const file of files) dt.items.add(file);
        if (fileInputRef.current) {
          fileInputRef.current.files = dt.files;
          fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    },
    [fileInputRef, onFilesAdded],
  );

  // ── Paste image from clipboard ─────────────────────────────────────────────

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const images = imageFilesFromPaste(event.nativeEvent);
      if (!images.length) return;
      // Prevent pasting the raw base64 text into the textarea
      event.preventDefault();
      if (onFilesAdded) {
        // Typed callback path — no synthetic events needed.
        onFilesAdded(images);
      } else {
        // Fallback: push images into the hidden input so native onChange fires.
        const dt = new DataTransfer();
        for (const file of images) dt.items.add(file);
        if (fileInputRef.current) {
          fileInputRef.current.files = dt.files;
          fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    },
    [fileInputRef, onFilesAdded],
  );

  // ── Slash-command keyboard handling ───────────────────────────────────────

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlashMenu && filteredSlashCommands.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSlashActiveIndex((i) => Math.min(filteredSlashCommands.length - 1, i + 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSlashActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const selected = filteredSlashCommands[slashActiveIndex];
          if (selected) {
            event.preventDefault();
            onDraftChange(`/${selected.name} `);
            return;
          }
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          // Dismiss the menu without wiping the draft.
          setSlashDismissed(true);
          return;
        }
      }
      onComposerKeyDown(event);
    },
    [showSlashMenu, filteredSlashCommands, slashActiveIndex, onDraftChange, onComposerKeyDown],
  );

  function handleSlashSelect(name: string) {
    onDraftChange(`/${name} `);
    composerRef.current?.focus();
  }

  const activeSlashOptionId =
    showSlashMenu && filteredSlashCommands.length > 0 && slashActiveIndex >= 0
      ? `${slashOptionIdPrefix}-${slashActiveIndex}`
      : undefined;

  return (
    <form
      className="composer"
      onSubmit={onSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {Boolean(sendError) && <div className="composer-error">{formatError(sendError)}</div>}
      {turnError && <div className="composer-error">{turnError}</div>}
      {Boolean(renameSessionError) && <div className="composer-error">{formatError(renameSessionError)}</div>}
      {Boolean(selectModelError) && <div className="composer-error">{formatError(selectModelError)}</div>}

      {attachedFiles.length > 0 && (
        <div className="composer-attachments">
          {attachedFiles.map((file, index) => (
            <AttachmentChip
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              index={index}
              onRemove={onRemoveAttachedFile}
            />
          ))}
        </div>
      )}

      <div className="composer-box" data-drag-over={isDragOver ? 'true' : undefined}>
        {showSlashMenu && filteredSlashCommands.length > 0 && (
          <SlashMenu
            commands={filteredSlashCommands}
            activeIndex={slashActiveIndex}
            onSelect={handleSlashSelect}
            menuId={slashMenuId}
            optionIdPrefix={slashOptionIdPrefix}
          />
        )}

        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleTextareaKeyDown}
          onPaste={handlePaste}
          placeholder="Message GoodVibes"
          aria-label="Message GoodVibes"
          aria-autocomplete={showSlashMenu ? 'list' : undefined}
          aria-controls={showSlashMenu && filteredSlashCommands.length > 0 ? slashMenuId : undefined}
          aria-activedescendant={activeSlashOptionId}
          rows={1}
        />
        <input ref={fileInputRef} type="file" hidden multiple onChange={onFileSelection} />

        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              type="button"
              className="composer-tool"
              title="Attach files"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSendPending}
            >
              <Paperclip size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="composer-tool"
              title="Voice mode is not available in this WebUI build"
              aria-label="Voice mode (unavailable)"
              disabled
            >
              <Mic size={16} aria-hidden />
            </button>
          </div>

          <ModelPicker
            providerOptions={providerOptions}
            selectedProviderId={selectedProviderId}
            providerModelOptions={providerModelOptions}
            selectedModelRegistryKey={selectedModelRegistryKey}
            selectModelPending={selectModelPending}
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
          />

          <div className="composer-actions">
            <button
              type="submit"
              className="send-button"
              title="Send message"
              aria-label="Send message"
              data-pending={isSendPending ? 'true' : undefined}
              disabled={isSendPending || (!draft.trim() && !attachedFiles.length)}
            >
              <Send size={18} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
