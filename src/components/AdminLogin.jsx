import { useState } from 'react';
import Modal from './Modal';
import { api, errorMessage } from '../api';

export default function AdminLogin({ onSuccess, onClose }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.admin.login(password);
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Grown-ups only 🔐" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          Parent password
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
