import { useEffect, useState } from 'react';
import { api, errorMessage, TYPE_META } from '../api';
import ViewerBar from '../components/ViewerBar';

export default function VideoPlayer({ item, session, online, onBack, onAdmin }) {
  const [src, setSrc] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setMessage('');
    api.content
      .getMediaUrl(item.id)
      .then((r) => {
        if (cancelled) return;
        if (r.url) setSrc(r.url);
        else setMessage(r.message);
      })
      .catch((e) => !cancelled && setMessage(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [item.id, online]);

  return (
    <div className="viewer">
      <ViewerBar
        title={item.title}
        icon={TYPE_META.video.icon}
        onBack={onBack}
        onAdmin={onAdmin}
        session={session}
        online={online}
      />
      <div className="video-stage">
        {src && !message ? (
          <video
            key={src}
            src={src}
            controls
            autoPlay
            controlsList="nodownload noremoteplayback noplaybackrate"
            disablePictureInPicture
            disableRemotePlayback
            onError={() => setMessage("Oops! This video couldn't be played.")}
          />
        ) : (
          <div className="viewer-message">
            <div className="empty-icon">{message ? '📡' : '⏳'}</div>
            <p>{message || 'Loading…'}</p>
          </div>
        )}
      </div>
      {item.description && <p className="viewer-desc">{item.description}</p>}
    </div>
  );
}
