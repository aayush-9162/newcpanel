// Resolve an ERP VendorID code (e.g. "FLEX", "SIGN") to a brand domain so the
// dashboard can show a vendor logo. Strategy:
//   1) explicit OVERRIDES for codes the fuzzy match can't get right, then
//   2) prefix-match the code against the known vendor names in vendors.js.
// Returns null when nothing matches (caller falls back to a generic icon).

import { VENDORS } from './vendors';

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Codes whose brand isn't obvious from a name prefix.
const OVERRIDES = {
  SIGN: 'ashleyfurniture.com',   // Signature Design by Ashley
  ASH:  'ashleyfurniture.com',
  ASHL: 'ashleyfurniture.com',
  CAT:  'catnapper.com',
  CATN: 'catnapper.com',
  JACK: 'catnapper.com',         // Jackson Furniture (gojfi)
  JFI:  'catnapper.com',
  LZB:  'la-z-boy.com',
  LAZ:  'la-z-boy.com',
  LAZB: 'la-z-boy.com',
  FOA:  'foagroup.com',
  HM:   'pulaskifurniture.com',  // Home Meridian
  PUL:  'pulaskifurniture.com',
  SM:   'southernmotion.com',
  SOM:  'southernmotion.com',
  TEMP: 'tempurpedic.com',
  TS:   'tempurpedic.com',
  SF:   'stearnsandfoster.com',
  ELRAN:'elran.com',
};

const NAME_DOMAINS = VENDORS
  .filter((v) => v.domain)
  .map((v) => ({ n: norm(v.name), domain: v.domain }));

export function vendorDomain(code) {
  const c = norm(code);
  if (!c) return null;
  if (OVERRIDES[c]) return OVERRIDES[c];
  // Code is a prefix of a vendor name (FLEX → FLEXSTEEL) or vice-versa.
  for (const { n, domain } of NAME_DOMAINS) {
    if (c.length >= 3 && (n.startsWith(c) || c.startsWith(n))) return domain;
  }
  return null;
}
