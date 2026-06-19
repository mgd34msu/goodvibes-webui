export interface ChatViewProps {
  activeSessionId: string;
  sessionItems: unknown[];
  onActiveSessionChange: (sessionId: string) => void;
  onDraftSessionRequestedChange: (requested: boolean) => void;
  onLocalSessionCreated: (session: unknown) => void;
  onLocalSessionUpdated: (sessionId: string, session: unknown) => void;
  onSessionMissing: (sessionId: string) => void;
}
