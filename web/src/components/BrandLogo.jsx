// BrandLogo — renders a company logo with graceful fallbacks so a card never
// shows a broken image or spams the console.
//
// IMPORTANT: this app runs on a locked-down office network that cannot resolve
// external hosts (logo.clearbit.com, gstatic favicons, etc. all fail with
// ERR_NAME_NOT_RESOLVED). So we do NOT fetch logos from the internet. Instead:
//   1. If the caller supplies a LOCAL image path via `src`, use it.
//   2. Otherwise render the `fallback` node (a lucide icon or an initials badge).
// To add a real logo later, drop the file in web/public/vendor-logos/ and pass
// its path as `src` — a same-origin asset that works offline.

import { useState } from 'react';

export function BrandLogo({ src = null, name = '', imgClassName = 'h-full w-full object-contain', fallback = null }) {
  // Track load failure so a bad local path still degrades to the fallback
  // instead of showing a broken-image icon.
  const [failed, setFailed] = useState(false);

  if (!src || failed) return fallback;

  return (
    <img
      src={src}
      alt={name ? `${name} logo` : ''}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={imgClassName}
    />
  );
}

// A neutral lettered badge — the default fallback when no local logo is set.
export function InitialsBadge({ name = '?', className = '' }) {
  const initials = String(name || '')
    .split(/[\s&/-]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return <span className={className}>{initials || '?'}</span>;
}
