import { useState } from 'react';
import { api, errorMessage } from '../api';

// First run: create the parent account and the first child profile.
export default function Setup({ onDone }) {
  const [form, setForm] = useState({ username: 'parent', password: '', confirm: '', childName: '', childAge: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) return setError('Password must be at least 6 characters.');
    if (form.password !== form.confirm) return setError('Passwords do not match.');
    if (!form.childName.trim()) return setError("Please enter your child's name.");
    setBusy(true);
    try {
      await api.setup.createAdmin({
        username: form.username,
        password: form.password,
        childName: form.childName,
        childAge: form.childAge,
      });
      onDone();
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
        <h1>Welcome to the E-Library</h1>
        <p className="muted">
          Let's set things up. This password protects the parent dashboard — keep it secret from the kids.
          To open the dashboard later, <strong>press and hold the 📖 logo for 3 seconds</strong>.
        </p>
        <div className="form-row">
          <label>
            Parent username
            <input value={form.username} onChange={set('username')} autoComplete="off" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Password
            <input type="password" value={form.password} onChange={set('password')} autoFocus />
          </label>
          <label>
            Confirm password
            <input type="password" value={form.confirm} onChange={set('confirm')} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Child's name
            <input value={form.childName} onChange={set('childName')} autoComplete="off" />
          </label>
          <label className="narrow">
            Age
            <input type="number" min="3" max="18" value={form.childAge} onChange={set('childAge')} />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary btn-big" disabled={busy}>
            {busy ? 'Setting up…' : 'Start the library'}
          </button>
        </div>
      </form>
    </div>
  );
}
