import { SyntheticEvent, useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Code2, KeyRound, Lock, Radio, Save, ShieldCheck, Wifi } from 'lucide-react';
import {
  clearStoredAuthToken,
  getCurrentAuth,
  invokeMethod,
  login,
  sdk,
  setExplicitAuthToken,
  WEBUI_TOKEN_STORE_KEY,
} from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { DataBlock } from '../components/DataBlock';
import { compactJson } from '../lib/object';
import { errorCode, errorDebugValue, formatError, serializeError } from '../lib/errors';
import { useWebUiPreferences } from '../lib/ui-preferences';
import { useToast } from '../lib/toast';
import ErrorBoundary from '../components/feedback/ErrorBoundary';
import { ErrorState } from '../components/feedback/ErrorState';
import { SkeletonBlock } from '../components/feedback/SkeletonBlock';
import '../styles/components/admin.css';

interface AdminViewProps {
  realtimeError?: string | null;
}

/** Classify a config save error into a user-readable toast message and tone. */
function classifyConfigError(error: unknown): { title: string; description: string; tone: 'danger' | 'warning' } {
  const serialized = serializeError(error);
  const status = typeof serialized.status === 'number' ? serialized.status : undefined;
  const category = typeof serialized.category === 'string' ? serialized.category : '';
  const code = errorCode(error);
  const message = formatError(error);

  if (status === 401 || code === 'UNAUTHORIZED') {
    return {
      title: 'Authentication required',
      description: message || 'Your session has expired — sign in again.',
      tone: 'danger',
    };
  }

  if (
    status === 403 ||
    code === 'PERMISSION_DENIED'
  ) {
    return {
      title: 'Permission denied',
      description: message || 'You do not have permission to set this config key.',
      tone: 'danger',
    };
  }

  if (status != null && status >= 400 && status < 500) {
    return {
      title: 'Request rejected',
      description: message || 'The server rejected the request.',
      tone: 'danger',
    };
  }

  if (status != null && status >= 500) {
    return {
      title: 'Server error',
      description: message || 'The daemon returned an error. Try again.',
      tone: 'danger',
    };
  }

  // Generic network / unknown
  return {
    title: 'Failed to save config',
    description: message || 'A network or request error occurred.',
    tone: 'danger',
  };
}

export function AdminView({ realtimeError }: AdminViewProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [configKey, setConfigKey] = useState('');
  const [configValue, setConfigValue] = useState('');
  const [configError, setConfigError] = useState('');
  /** JSON parse error for inline textarea feedback (non-blocking). */
  const [jsonError, setJsonError] = useState('');
  const [preferences, setPreference] = useWebUiPreferences();

  /** Focus target: key input receives focus after a successful config save. */
  const configKeyRef = useRef<HTMLInputElement>(null);

  /** Live-validate JSON as the user types in the value textarea. */
  const handleConfigValueChange = useCallback((value: string) => {
    setConfigValue(value);
    if (!value.trim()) {
      setJsonError('');
      return;
    }
    try {
      JSON.parse(value);
      setJsonError('');
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, []);

  const auth = useQuery({ queryKey: queryKeys.auth, queryFn: getCurrentAuth });
  const status = useQuery({ queryKey: queryKeys.status, queryFn: () => sdk.operator.control.status() });
  const localAuth = useQuery({ queryKey: queryKeys.localAuth, queryFn: () => invokeMethod('local_auth.status') });

  const loginMutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: async () => {
      setPassword('');
      await queryClient.invalidateQueries();
    },
  });

  const tokenMutation = useMutation({
    mutationFn: () => setExplicitAuthToken(token),
    onSuccess: async () => {
      setToken('');
      await queryClient.invalidateQueries();
    },
  });

  const clearTokenMutation = useMutation({
    mutationFn: clearStoredAuthToken,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const saveConfig = useMutation({
    mutationFn: () => {
      const savedKey = configKey.trim();
      setConfigError('');
      let parsed: unknown = configValue;
      if (configValue.trim()) {
        try {
          parsed = JSON.parse(configValue);
        } catch {
          parsed = configValue;
        }
      }
      if (!savedKey) {
        const validationMsg = 'Config key is required';
        setConfigError(validationMsg);
        throw new Error(validationMsg);
      }
      return invokeMethod('config.set', { key: savedKey, value: parsed });
    },
    onSuccess: async () => {
      const savedKey = configKey.trim();
      setConfigKey('');
      setConfigValue('');
      setConfigError('');
      setJsonError('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.control });
      toast({
        title: 'Config saved',
        description: `Key “${savedKey}” updated successfully.`,
        tone: 'success',
      });
      // Return focus to the key input so keyboard users can set another key.
      requestAnimationFrame(() => {
        configKeyRef.current?.focus();
      });
    },
    onError: (error) => {
      const msg = formatError(error);
      setConfigError(msg);

      // Validation errors (empty key) — shown inline only, no toast needed.
      if (msg === 'Config key is required') return;

      const { title, description, tone } = classifyConfigError(error);
      toast({ title, description, tone });
    },
  });

  const loginDiagnostics = {
    route: 'POST /login',
    transport: 'raw fetch without Authorization header or cookies',
    currentAuth: auth.data,
    currentAuthError: errorDebugValue(auth.error),
    localAuth: localAuth.data,
    localAuthError: errorDebugValue(localAuth.error),
    loginError: errorDebugValue(loginMutation.error),
  };

  function submitLogin(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username && password) loginMutation.mutate();
  }

  function submitConfig(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    saveConfig.mutate();
  }

  function submitToken(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token.trim()) tokenMutation.mutate();
  }

  return (
    <ErrorBoundary>
      {/* aria-live region for ephemeral status announcements */}
      <div aria-live="polite" aria-atomic="true" className="admin-status-live">
        {realtimeError ? `Realtime stream degraded: ${realtimeError}` : ''}
      </div>

      <div className="stack">
        <section className="auth-guidance">
          <div>
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2>Daemon-Owned Auth</h2>
            <p>
              Browser code cannot read <code>~/.goodvibes</code> files. Sign in through the daemon or paste a credential explicitly;
              the WebUI stores only the browser session token under <code>{WEBUI_TOKEN_STORE_KEY}</code>.
            </p>
          </div>
        </section>

        <div className="two-column">
          <section className="panel">
            <div className="panel-title">
              <h2>Session Login</h2>
              <Lock size={18} />
            </div>
            <form className="form-grid" onSubmit={submitLogin}>
              <label>
                Username
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
              </label>
              <label>
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <button className="primary-button" type="submit" disabled={loginMutation.isPending || !username || !password}>
                Sign in
              </button>
            </form>
            {loginMutation.error && (
              <div className="banner warning">{formatError(loginMutation.error)}</div>
            )}
            <p className="form-note">
              Uses a direct daemon login request without Authorization or cookies, then stores only the returned browser session.
            </p>
            <details className="diagnostic-block">
              <summary>Login diagnostics</summary>
              <pre>{compactJson(loginDiagnostics)}</pre>
            </details>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>Explicit Token</h2>
              <KeyRound size={18} />
            </div>
            <form className="form-grid" onSubmit={submitToken}>
              <label>
                Operator token
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  autoComplete="off"
                  placeholder="Paste token deliberately"
                />
              </label>
              <button className="primary-button" type="submit" disabled={tokenMutation.isPending || !token.trim()}>
                Validate and store
              </button>
              <button className="secondary-button" type="button" disabled={clearTokenMutation.isPending} onClick={() => clearTokenMutation.mutate()}>
                Clear stored token
              </button>
            </form>
            {tokenMutation.error && (
              <div className="banner warning">{formatError(tokenMutation.error)}</div>
            )}
            <p className="form-note">
              The token is validated with <code>sdk.auth.current()</code>. Invalid tokens are cleared immediately.
            </p>
          </section>
        </div>

        <div className="two-column">
          <section className="panel">
            {auth.isPending ? (
              <div className="admin-skeleton-group" aria-label="Loading auth status">
                <SkeletonBlock height={16} width="60%" />
                <SkeletonBlock variant="text" lines={3} />
              </div>
            ) : auth.error ? (
              <ErrorState error={auth.error} onRetry={() => auth.refetch()} title="Auth status unavailable" />
            ) : (
              <DataBlock title="Current Auth" value={auth.data} />
            )}
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>Config API</h2>
              <Save size={18} />
            </div>
            <form className="form-grid" onSubmit={submitConfig}>
              <label>
                Key
                <input
                  ref={configKeyRef}
                  value={configKey}
                  onChange={(event) => setConfigKey(event.target.value)}
                  placeholder="settings.path"
                />
              </label>
              <label>
                Value
                <textarea
                  value={configValue}
                  onChange={(event) => handleConfigValueChange(event.target.value)}
                  placeholder="JSON or text"
                  aria-describedby={jsonError ? 'admin-json-error' : undefined}
                  className={jsonError ? 'admin-config-textarea--invalid' : undefined}
                />
                {jsonError && (
                  <span id="admin-json-error" className="admin-config-json-error" role="alert">
                    {jsonError}
                  </span>
                )}
              </label>
              <button className="primary-button" type="submit" disabled={saveConfig.isPending || !configKey.trim()}>
                Save
              </button>
            </form>
            {configError && <div className="banner warning" role="alert">{configError}</div>}
          </section>
        </div>

        <section className="panel">
          <div className="panel-title">
            <h2>Display Preferences</h2>
            <Code2 size={18} />
          </div>
          <div className="form-grid">
            <label className="check-row preference-row">
              <input
                type="checkbox"
                checked={preferences.codeBlockLineNumbers}
                onChange={(event) => setPreference('codeBlockLineNumbers', event.target.checked)}
              />
              <span>Show line numbers in rendered code blocks</span>
            </label>
          </div>
          <p className="form-note">
            Line numbers are decorative only. Copy buttons and whole-message copy use the raw response text without line numbers.
          </p>
        </section>

        <div className="two-column">
          <section className="panel">
            {status.isPending ? (
              <div className="admin-skeleton-group" aria-label="Loading daemon status">
                <SkeletonBlock height={16} width="50%" />
                <SkeletonBlock variant="text" lines={4} />
              </div>
            ) : status.error ? (
              <ErrorState error={status.error} onRetry={() => status.refetch()} title="Daemon status unavailable" />
            ) : (
              <DataBlock title="Daemon Status" value={status.data} />
            )}
          </section>
          <section className="panel">
            {localAuth.isPending ? (
              <div className="admin-skeleton-group" aria-label="Loading local auth status">
                <SkeletonBlock height={16} width="50%" />
                <SkeletonBlock variant="text" lines={3} />
              </div>
            ) : localAuth.error ? (
              <ErrorState error={localAuth.error} onRetry={() => localAuth.refetch()} title="Local auth unavailable" />
            ) : (
              <DataBlock title="Local Auth" value={localAuth.data} />
            )}
          </section>
        </div>

        <section className="panel">
          <div className="panel-title">
            <h2>Surface Runtime</h2>
            <Activity size={18} />
          </div>
          <div
            className="runtime-grid"
            aria-live="polite"
            aria-atomic="false"
            aria-label="Surface runtime status"
          >
            <div>
              <Radio size={16} />
              <strong>3423</strong>
              <span>Browser surface</span>
            </div>
            <div>
              <Wifi size={16} />
              <strong>3421</strong>
              <span>Control plane</span>
            </div>
            <div>
              <span className={realtimeError ? 'status-dot warning' : 'status-dot ok'} />
              <strong>{realtimeError ? 'Degraded' : 'Listening'}</strong>
              <span>{realtimeError ?? 'Realtime event stream'}</span>
            </div>
          </div>
        </section>
      </div>
    </ErrorBoundary>
  );
}
