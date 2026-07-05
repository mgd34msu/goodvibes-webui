/**
 * SignedOutGate — the honest first-paint front door.
 *
 * Replaces the old behavior where the full operator shell rendered regardless of auth
 * and merely dropped a dismissible banner while every API call 401'd. When auth.current
 * reports signed-out, this screen is shown INSTEAD of the shell: the nav and views are
 * gated behind it.
 *
 * Paste-token is the primary path (setExplicitAuthToken self-validates via auth.current
 * and auto-clears on failure). Password login is offered only as a de-emphasized
 * secondary path — on hosts where the bootstrap credential was already consumed it is
 * structurally dead, so it must not be presented co-equal with the token path.
 */

import { KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { login, setExplicitAuthToken } from '../../lib/goodvibes';
import { formatError } from '../../lib/errors';
import '../../styles/components/auth-gate.css';

export function SignedOutGate() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const tokenMutation = useMutation({
    mutationFn: () => setExplicitAuthToken(token.trim()),
    onSuccess: async () => {
      setToken('');
      // Revalidate everything — auth/boot/health flip to signed-in and the shell reveals.
      await queryClient.invalidateQueries();
    },
  });

  const loginMutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: async () => {
      setPassword('');
      await queryClient.invalidateQueries();
    },
  });

  function submitToken(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token.trim()) tokenMutation.mutate();
  }

  function submitLogin(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username && password) loginMutation.mutate();
  }

  return (
    <div className="signed-out-gate" role="main">
      <div className="signed-out-card">
        <div className="signed-out-mark">
          <ShieldCheck size={28} aria-hidden="true" />
        </div>
        <h1>Sign in to GoodVibes</h1>
        <p className="signed-out-lede">
          This operator shell talks to a daemon that requires an operator token. Browser
          code cannot read <code>~/.goodvibes</code> files, so paste a token to sign in.
        </p>

        <form className="form-grid" onSubmit={submitToken}>
          <label>
            Operator token
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder="Paste an operator token"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- primary action on a dedicated sign-in screen
              autoFocus
            />
          </label>
          <button className="primary-button" type="submit" disabled={tokenMutation.isPending || !token.trim()}>
            {tokenMutation.isPending ? 'Validating…' : 'Sign in with token'}
          </button>
        </form>

        {tokenMutation.error && (
          <div className="banner warning" role="alert">
            {formatError(tokenMutation.error)} — the token was rejected and cleared. Paste a fresh one.
          </div>
        )}

        <details className="signed-out-help">
          <summary>Where do I find a token?</summary>
          <ul>
            <li>
              The daemon prints an operator token in its startup output when it boots.
            </li>
            <li>
              It is also written to the daemon&rsquo;s <code>operator-tokens.json</code>, or
              mint one from the TUI.
            </li>
            <li>
              Operator tokens are typically ephemeral — if sign-in stops working, the token
              likely expired; grab the current one from the daemon output.
            </li>
          </ul>
        </details>

        <div className="signed-out-secondary">
          <button
            type="button"
            className="link-button"
            onClick={() => setShowPassword((current) => !current)}
            aria-expanded={showPassword}
          >
            <KeyRound size={13} aria-hidden="true" /> Use a username &amp; password instead
          </button>
          {showPassword && (
            <form className="form-grid signed-out-password" onSubmit={submitLogin}>
              <p className="form-note">
                Password login only works on hosts where the daemon still holds a bootstrap
                credential. If it was already consumed, this path will not work — use a token.
              </p>
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
              <button className="secondary-button" type="submit" disabled={loginMutation.isPending || !username || !password}>
                {loginMutation.isPending ? 'Signing in…' : 'Sign in with password'}
              </button>
              {loginMutation.error && (
                <div className="banner warning" role="alert">{formatError(loginMutation.error)}</div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
