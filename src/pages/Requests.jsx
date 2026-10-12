import { useState } from 'react';
import { useServerData } from '../api';
import RequestList from '../components/RequestList';

export default function Requests({ onRequestsChanged }) {
  const [status, setStatus] = useState('pending');
  const { data, error, reload } = useServerData(`/api/v1/requests${status === 'all' ? '' : `?status=${status}`}`, { poll: 30_000 });

  return (
    <section>
      <div className="panel-header">
        <h1>Access requests</h1>
        <div className="segmented">
          {['pending', 'approved', 'denied', 'all'].map((s) => (
            <label key={s}>
              <input type="radio" checked={status === s} onChange={() => setStatus(s)} /> {s[0].toUpperCase() + s.slice(1)}
            </label>
          ))}
        </div>
      </div>
      <p className="muted">
        Approving a locked item unlocks it on every laptop. Approving a blocked web page allows that website from the site
        the child was using. Free-text requests are reminders — add the content yourself.
      </p>
      {error && <p className="form-error">{error}</p>}
      <RequestList
        requests={data || []}
        emptyText={`No ${status === 'all' ? '' : status} requests.`}
        onChanged={() => {
          reload();
          onRequestsChanged();
        }}
      />
    </section>
  );
}
