const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const num = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtCurrency = (n, cents = false) => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v == null || isNaN(v)) return '—';
  return (cents ? usdCents : usd).format(v);
};

export const fmtNumber = (n) => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v == null || isNaN(v)) return '—';
  return num.format(v);
};

export const fmtCompact = (n) => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v == null || isNaN(v)) return '—';
  return compact.format(v);
};

// Compact currency format for tight spaces (hero tiles).
// $3,135,723 → "$3.14M" · $9,230 → "$9.2k" · keeps small values exact.
export const fmtCompactCurrency = (n) => {
  const v = typeof n === 'number' ? n : parseFloat(String(n).replace(/[^\d.\-]/g, ''));
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (abs >= 10_000)    return `${sign}$${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return fmtCurrency(v);
};

export const fmtPercent = (n, digits = 1) => {
  if (n == null || isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
};

export const trimStr = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  return String(v);
};
