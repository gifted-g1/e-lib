import { useServerData, formatDateTime, formatMinutes, isOnline, timeAgo } from '../api';
import RequestList from '../components/RequestList';

const ACTION_LABELS = {
  open: 'opened',
  request: 'asked for',
  blocked: 'was blocked from',
  time_lock: 'ran out of time',
  login: 'started using the library',
};

export default function Overview({ onNavigate, onRequestsChanged }) {
  const devices = useServerData('/api/v1/devices', { poll: 30_000 });
  const pending = useServerData('/api/v1/requests?status=pending', { poll: 30_000 });
  const activity = useServerData('/api/v1/activity?limit=12', { poll: 30_000 });

  const list = devices.data || [];
  const online = list.filter(isOnline).length;

  return (
    <section>
      <div className="panel-header">
        <h1>Overview</h1>
      </div>
      {devices.error && <p className="form-error">{devices.error}</p>}

      <div className="stat-row">
        <div className="stat">
          <div className="stat-value">{list.length}</div>
          <div className="stat-label">Laptops</div>
        </div>
        <div className="stat">
          <div className="stat-value">{online}</div>
          <div className="stat-label">Online now</div>
        </div>
        <div className="stat">
          <div className="stat-value">{pending.data?.length ?? '–'}</div>
          <div className="stat-label">Waiting requests</div>
        </div>
      </div>

      {list.length === 0 && devices.data && (
        <div className="empty-admin section">
          <p>No laptops connected yet.</p>
          <button className="btn btn-primary" onClick={() => onNavigate('laptops')}>
            ＋ Connect a laptop
          </button>
        </div>
      )}

      <div className="grid-cards">
        {list.map((d) => (
          <div key={d.id} className="device-card">
            <h3>
              <span className={`dot ${isOnline(d) ? 'dot-online' : ''}`} /> {d.name}
            </h3>
            <span className="muted small">
              {d.hardware_id ? (isOnline(d) ? 'Online' : `Last seen ${timeAgo(d.last_seen_at)}`) : 'Not connected yet'}
              {d.daily_limit_minutes > 0 && ` · limit ${d.daily_limit_minutes} min/day`}
            </span>
            {(d.children || []).map((c) => (
              <div key={c.local_id} className="child-line">
                <span>
                  {c.avatar || '🧒'} {c.name}
                </span>
                <span className="muted">
                  {c.usage_seconds != null ? `${formatMinutes(c.usage_seconds)} on ${c.usage_day}` : 'no use yet'}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="section">
        <h2>Waiting for your answer</h2>
        <RequestList
          requests={pending.data || []}
          emptyText="Nothing waiting. 🎉"
          onChanged={() => {
            pending.reload();
            onRequestsChanged();
          }}
        />
      </div>

      <div className="section">
        <h2>Recent activity</h2>
        {(activity.data || []).length === 0 ? (
          <div className="empty-admin">No activity yet.</div>
        ) : (
          <ul className="admin-list">
            {activity.data.map((a) => (
              <li key={a.id} className="admin-row">
                <div className="row-main">
                  <span>
                    <strong>{a.child_name || 'Someone'}</strong> {ACTION_LABELS[a.action] || a.action}{' '}
                    {a.content_title && <strong>{a.content_title}</strong>}
                  </span>
                  <span className="muted small">
                    {a.device_name} · {formatDateTime(a.timestamp)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
