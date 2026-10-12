import { useEffect, useState } from 'react';
import { bridge, errorMessage } from '../api';

export default function Login({ initial, onSignedIn }) {
  const [server, setServer] = useState(initial.server || '');
  const [email, setEmail] = useState(initial.email || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mode, setMode] = useState('login'); // login | register
  const [signupOpen, setSignupOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Offer "create account" only when the server allows it (first account, or signups enabled).
  useEffect(() => {
    setSignupOpen(false);
    if (!server.trim()) return undefined;
    const t = setTimeout(() => {
      bridge.auth
        .status(server)
        .then((s) => {
          setSignupOpen(s.signup_open);
          if (!s.has_accounts) setMode('register');
        })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [server]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const fn = mode === 'register' ? bridge.auth.register : bridge.auth.login;
      onSignedIn(await fn({ server, email, password }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card setup-card form" onSubmit={submit}>
        <div className="setup-hero">📖</div>
        <h1>{mode === 'register' ? 'Create your parent account' : 'E-Library Parent'}</h1>
        <p className="muted">
          Manage your children's library laptops from here: add videos, books and websites, set time limits and answer
          requests.
        </p>
        <label>
          Server address
          <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://library.example.org" autoFocus={!server} />
        </label>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <div className="form-row">
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              autoFocus={!!server}
            />
          </label>
          {mode === 'register' && (
            <label>
              Confirm password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </label>
          )}
        </div>
        {mode === 'register' && <p className="hint">At least 8 characters.</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions spread">
          {signupOpen ? (
            <button type="button" className="btn btn-link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Create an account' : 'I already have an account'}
            </button>
          ) : (
            <span />
          )}
          <button className="btn btn-primary btn-big" disabled={busy || !server || !email || !password}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
