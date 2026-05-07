export interface ComposerKeyEventLike {
  key: string;
  shiftKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
}

export function shouldSubmitComposerKey(event: ComposerKeyEventLike): boolean {
  return event.key === 'Enter' && !event.shiftKey && event.nativeEvent?.isComposing !== true;
}
