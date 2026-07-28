// Shared list of in-app forms — used by the Dashboard "Quick Forms" section
// and the Control Panel forms grid. Single source of truth for label,
// description, icon, accent, and route.

import {
  UserCog, TrendingUp, UserPlus, AlertTriangle, Boxes,
} from 'lucide-react';

export const FORMS = [
  {
    label: 'Associate Manager Form',
    description: 'Daily check-in for store managers',
    to: '/mpf',
    icon: UserCog,
    accent: 'primary',
  },
  {
    label: 'Sales Performance Form',
    description: 'Salesperson scorecard submission',
    to: '/spf',
    icon: TrendingUp,
    accent: 'emerald',
  },
  {
    label: 'Prospective Buyer Form',
    description: 'Capture details of a new walk-in lead',
    to: '/pbf',
    icon: UserPlus,
    accent: 'rose',
  },
  {
    label: 'Report Damage',
    description: 'Log a damaged or returned item',
    to: '/damage/create',
    icon: AlertTriangle,
    accent: 'amber',
  },
  {
    label: 'Inventory Request Form',
    description: 'Request inventory transfer between locations',
    to: '/mrf',
    icon: Boxes,
    accent: 'violet',
  },
];
