import { useLongPress } from '../hooks';

// The library logo doubles as the hidden parent entry point: press and hold for 3 seconds.
export default function Logo({ onAdmin, small = false }) {
  const press = useLongPress(onAdmin || (() => {}), 3000);
  return (
    <div className={`logo ${small ? 'logo-small' : ''}`} {...press} aria-label="E-Library">
      <span className="logo-mark">📖</span>
      {!small && <span className="logo-text">My Library</span>}
    </div>
  );
}
