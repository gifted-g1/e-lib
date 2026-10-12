import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import Logo from '../components/Logo';

const DEFAULT_AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦁', '🐨', '🐙', '🦄'];

export default function ProfilePicker({ onPicked, onAdmin }) {
  const [children, setChildren] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.children.list().then(setChildren).catch((e) => setError(errorMessage(e)));
  }, []);

  async function pick(id) {
    try {
      await api.children.select(id);
      onPicked();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="center-page">
      <Logo onAdmin={onAdmin} />
      <h1 className="big-heading">Who's learning today?</h1>
      {error && <p className="form-error">{error}</p>}
      {children && children.length === 0 && (
        <p className="muted">No profiles yet. Ask a grown-up to add one.</p>
      )}
      <div className="profiles">
        {(children || []).map((c, i) => (
          <button key={c.id} className="profile" onClick={() => pick(c.id)}>
            <span className="profile-avatar">{c.avatar || DEFAULT_AVATARS[i % DEFAULT_AVATARS.length]}</span>
            <span className="profile-name">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
