import Logo from './Logo';
import StatusPills from './StatusPills';

// Top bar for the video / PDF / website viewers. No address bar -- only "back to library".
export default function ViewerBar({ title, icon, onBack, onAdmin, session, online, children }) {
  return (
    <header className="viewer-bar">
      <button className="btn btn-back" onClick={onBack}>
        ← Library
      </button>
      {children}
      <h1 className="viewer-title">
        <span aria-hidden="true">{icon}</span> {title}
      </h1>
      <StatusPills online={online} remainingMinutes={session.remainingMinutes} />
      <Logo small onAdmin={onAdmin} />
    </header>
  );
}
