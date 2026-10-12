import { useEffect } from 'react';

export default function Toast({ message, onDone, ms = 3500 }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [message, onDone, ms]);
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
