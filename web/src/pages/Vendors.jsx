// Vendors & Price Sheets — full-page directory of every vendor's website and
// price sheets. Opened in a new tab from the Quick Access header shortcut.
// Reuses the same VendorSites grid used on the Control Panel, fully expanded.

import { Topbar } from '@/components/Topbar';
import { VendorSites } from '@/pages/CPanel';

export default function Vendors() {
  return (
    <>
      <Topbar title="Vendor Website / Price List" subtitle="Every vendor's site and price sheets" />
      <div className="flex flex-1 flex-col gap-6 p-5 animate-fade-in">
        <VendorSites forceAll />
      </div>
    </>
  );
}
