import './style.css';
import { mountApp } from './ui/app';

mountApp(document.getElementById('app')!);

// offline support / add to home screen (production only: in development it would cache stale modules)
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));

// Only the canvas zooms (with its own pinch / wheel handling). Stop the browser from zooming the
// whole page, which pushes the toolbars off screen: iOS gesture events, multi-finger moves outside
// the canvas, and double-tap zoom.
for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !(e.target as HTMLElement).closest('canvas')) e.preventDefault();
}, { passive: false });
