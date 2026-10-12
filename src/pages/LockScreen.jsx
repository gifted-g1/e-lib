import Logo from '../components/Logo';

export default function LockScreen({ session, onAdmin }) {
  const icon = session.lockReason === 'schedule' ? '🌙' : '⏰';
  return (
    <div className="center-page lock-screen">
      <div className="lock-icon">{icon}</div>
      <h1 className="big-heading">{session.lockReason === 'schedule' ? 'The library is closed' : "Time's up for today!"}</h1>
      <p className="lock-message">{session.lockMessage}</p>
      <div className="lock-footer">
        <Logo small onAdmin={onAdmin} />
      </div>
    </div>
  );
}
