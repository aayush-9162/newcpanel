// BrandLogo — renders a company logo pulled from its domain, with graceful
// fallbacks so a card never shows a broken image.
//
// Source cascade (advance on error):
//   1. Clearbit Logo API   — real brand logo, transparent PNG (best quality)
//   2. Google favicon @128  — reliable, exists for almost every live domain
//   3. `fallback` node (a lucide icon or an initials badge)
//
// Logos are rendered on a white, padded tile by the caller so they read
// cleanly regardless of the source's own background.

import { useMemo, useState } from 'react';

export function BrandLogo({ domain, name = '', imgClassName = 'h-full w-full object-contain', fallback = null }) {
  const sources = useMemo(() => (domain ? [
    `https://logo.clearbit.com/${domain}?size=128`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  ] : []), [domain]);
  const [idx, setIdx] = useState(0);

  const src = sources[idx];
  if (!src) return fallback;

  return (
    <img
      src={src}
      alt={name ? `${name} logo` : ''}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setIdx((i) => i + 1)}
      className={imgClassName}
    />
  );
}

// A neutral lettered badge — the last-resort fallback when no logo resolves.
export function InitialsBadge({ name = '?', className = '' }) {
  const initials = name.split(/[\s&/-]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return <span className={className}>{initials || '?'}</span>;
}
