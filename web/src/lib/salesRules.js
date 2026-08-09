// Shared showroom-category + item-type classification rules and the SQL CASE
// expressions built from them. Used by the Dashboard (monthly) and
// DashboardDaily (yesterday) so both classify items identically.
//
// Keyword matching is against a short `d2` alias (= UPPER(Description2)) so the
// CASE expression stays compact and under the SQL-guard length cap. Rules are
// checked in priority order (first match wins) — e.g. a "dining side chair"
// lands in Dining before the generic "chair" rule sends it to Living Room.
// NOTE: avoid the word "DROP" anywhere (SQL-guard blocks it) — "LEAF" still
// catches drop-leaf tables.

import { Utensils, BedDouble, Lamp, Sofa } from 'lucide-react';

export const ROOM_RULES = [
  { key: 'Dining Room', icon: Utensils, accent: 'amber',
    kw: ['DINING','DINETTE','BUFFET','SERVER','CHINA','BARSTOOL','BAR STOOL','COUNTER STOOL',
         'COUNTER HEIGHT','SIDEBOARD','PUB ','SIDE CHAIR','DINING CHAIR','LEAF','PEDESTAL','DRM'] },
  { key: 'Bedroom', icon: BedDouble, accent: 'violet',
    kw: ['DRESSER','NIGHTSTAND','NIGHT STAND','CHEST','HEADBOARD','FOOTBOARD','ARMOIRE','MATTRESS',
         'MATT ','CHIFFEROBE',' BED','DAYBED','TRUNDLE','BUNK','LOFT','STORAGE STEP','RAILS','SLATS',
         'FOUNDATION',' FND','BOX SPRING','PANEL'] },
  { key: 'Accessories', icon: Lamp, accent: 'emerald',
    kw: ['MIRROR','LAMP','RUG','PILLOW','THROW','DECOR','CLOCK','CUSHION','ACCESSOR','BATTERY','PROTECTOR'] },
  { key: 'Living Room', icon: Sofa, accent: 'primary',
    kw: ['SOFA','LOVESEAT','LOVE SEAT','RECLIN',' REC ','REC W','PWR REC','REC LS','SECTIONAL','WEDGE',
         'CHAISE','OTTOMAN','CONSOLE','COCKTAIL','END TABLE','SOFA TABLE','ACCENT','GLIDER','GLDR',
         'SLEEPER','SETTEE','SWIVEL','SWVL','UPHOLSTERY',' LS ','CHAIR','CORNER'] },
];

export const ITEM_TYPE_RULES = [
  { key: 'Loveseat',      kw: ['LOVESEAT','LOVE SEAT',' LS '] },
  { key: 'Sectional',     kw: ['SECTIONAL','WEDGE',' LAF',' RAF','ARMLESS','CORNER'] },
  { key: 'Chaise',        kw: ['CHAISE'] },
  { key: 'Sofa',          kw: ['SOFA'] },
  { key: 'Recliner',      kw: ['RECLIN',' REC ','PWR REC','REC W','GLIDER','GLDR','ROCKER'] },
  { key: 'Ottoman',       kw: ['OTTOMAN'] },
  { key: 'Stool',         kw: ['STOOL','BARSTOOL'] },
  { key: 'Chair',         kw: ['CHAIR'] },
  { key: 'Table',         kw: ['COCKTAIL','END TABLE','SOFA TABLE','CONSOLE','PEDESTAL','LEAF','TABLE'] },
  { key: 'Dresser',       kw: ['DRESSER'] },
  { key: 'Nightstand',    kw: ['NIGHTSTAND','NIGHT STAND'] },
  { key: 'Chest',         kw: ['CHEST'] },
  { key: 'Bed',           kw: ['HEADBOARD','FOOTBOARD',' BED','RAILS','PANEL','DAYBED','BUNK','TRUNDLE'] },
  { key: 'Mattress',      kw: ['MATTRESS','MATT ','FOUNDATION','BOX SPRING','SLATS',' FND'] },
  { key: 'Mirror',        kw: ['MIRROR'] },
  { key: 'Buffet/Server', kw: ['BUFFET','SERVER','SIDEBOARD','CHINA'] },
  { key: 'Lamp',          kw: ['LAMP'] },
  { key: 'Rug',           kw: ['RUG'] },
  { key: 'Accessory',     kw: ['PILLOW','THROW','DECOR','CLOCK','CUSHION','ACCESSOR','PROTECTOR','BATTERY'] },
];

const likeClause = (kw) => kw.map((k) => `d2 LIKE '%${k}%'`).join(' OR ');

// SQL CASE expressions (match against the `d2` alias). First match wins.
export const roomCase = `CASE ${ROOM_RULES.map((r) => `WHEN ${likeClause(r.kw)} THEN '${r.key}'`).join(' ')} ELSE 'Other' END`;
export const itemTypeCase = `CASE ${ITEM_TYPE_RULES.map((r) => `WHEN ${likeClause(r.kw)} THEN '${r.key}'`).join(' ')} ELSE 'Other' END`;
