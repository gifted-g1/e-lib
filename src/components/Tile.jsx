import { TYPE_META } from '../api';

export default function Tile({ item, online, onOpen, onRequest }) {
  const meta = TYPE_META[item.type];
  const locked = !item.is_approved;
  const unavailable = !locked && !online && item.needs_internet;

  let badge = null;
  if (locked) badge = <span className="tile-badge badge-locked">🔒 Locked</span>;
  else if (unavailable) badge = <span className="tile-badge badge-offline">📡 Needs internet</span>;
  else if (item.available_offline) badge = <span className="tile-badge badge-ready">✓ Ready</span>;

  return (
    <div className={`tile ${meta.className} ${locked ? 'tile-locked' : ''} ${unavailable ? 'tile-unavailable' : ''}`}>
      <button
        className="tile-main"
        onClick={() => onOpen(item)}
        disabled={locked}
        aria-label={`${meta.label}: ${item.title}`}
      >
        <div className="tile-thumb">
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt="" draggable={false} loading="lazy" />
          ) : (
            <span className="tile-icon" aria-hidden="true">
              {meta.icon}
            </span>
          )}
          {badge}
        </div>
        <div className="tile-body">
          <span className="tile-type">{meta.label}</span>
          <span className="tile-title">{item.title}</span>
          {item.description && <span className="tile-desc">{item.description}</span>}
        </div>
      </button>
      {locked && (
        <button className="btn btn-request" onClick={() => onRequest(item)}>
          🙋 Request Access
        </button>
      )}
    </div>
  );
}
