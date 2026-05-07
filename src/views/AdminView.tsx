import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, KeyRound, Lock, Radio, Save, ShieldCheck, Wifi } from 'lucide-react';
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
import { errorDebugValue, formatError } from '../lib/errors';

interface AdminViewProps {
  realtimeError?: string | null;
}

export function AdminView({ realtimeError }: AdminViewProps) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [configKey, setConfigKey] = useState('');
  const [configValue, setConfigValue] = useState('');
  const [configError, setConfigError] = useState('');

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
      setConfigError('');
      let parsed: unknown = configValue;
      if (configValue.trim()) {
        try {
          parsed = JSON.parse(configValue);
        } catch {
          parsed = configValue;
        }
      }
      if (!configKey.trim()) {
        setConfigError('Config key is required');
        throw new Error('Config key is required');
      }
      return invokeMethod('config.set', { key: configKey.trim(), value: parsed });
    },
    onSuccess: async () => {
      setConfigKey('');
      setConfigValue('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.control });
    },
    onError: (error) => {
      setConfigError(formatError(error));
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

  function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (username && password) loginMutation.mutate();
  }

  function submitConfig(event: FormEvent) {
    event.preventDefault();
    saveConfig.mutate();
  }

  function submitToken(event: FormEvent) {
    event.preventDefault();
    if (token.trim()) tokenMutation.mutate();
  }

  return (
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
          <DataBlock title="Current Auth" value={auth.data} />
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Config API</h2>
            <Save size={18} />
          </div>
          <form className="form-grid" onSubmit={submitConfig}>
            <label>
              Key
              <input value={configKey} onChange={(event) => setConfigKey(event.target.value)} placeholder="settings.path" />
            </label>
            <label>
              Value
              <textarea value={configValue} onChange={(event) => setConfigValue(event.target.value)} placeholder="JSON or text" />
            </label>
            <button className="primary-button" type="submit" disabled={saveConfig.isPending || !configKey.trim()}>
              Save
            </button>
          </form>
          {configError && <div className="banner warning">{configError}</div>}
        </section>
      </div>

      <div className="two-column">
        <DataBlock title="Daemon Status" value={status.data} />
        <DataBlock title="Local Auth" value={localAuth.data} />
      </div>

      <section className="panel">
        <div className="panel-title">
          <h2>Surface Runtime</h2>
          <Activity size={18} />
        </div>
        <div className="runtime-grid">
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
            <span>{realtimeError || 'Realtime event stream'}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
