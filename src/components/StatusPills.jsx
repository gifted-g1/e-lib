export default function StatusPills({ online, remainingMinutes }) {
  return (
    <div className="status-pills">
      {remainingMinutes != null && (
        <span className={`pill ${remainingMinutes <= 5 ? 'pill-warn' : ''}`}>⏱ {remainingMinutes} min left</span>
      )}
      <span className={`pill ${online ? 'pill-online' : 'pill-offline'}`}>
        {online ? '● Online' : '● Offline'}
      </span>
    </div>
  );
}
