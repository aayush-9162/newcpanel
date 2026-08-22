import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout.jsx';
import CPanel from '@/pages/CPanel.jsx';
import Dashboard from '@/pages/Dashboard.jsx';
import Admin from '@/pages/Admin.jsx';
import StubPage from '@/pages/StubPage.jsx';
import { routes } from '@/routes';
import { RequireRoute } from '@/auth/AuthProvider';

// --- Reports ---
import SCR from '@/pages/SCR.jsx';
import ItemSoldAnalysis from '@/pages/ItemSoldAnalysis.jsx';
import TrackerReport from '@/pages/TrackerReport.jsx';
import ManagerPerformance from '@/pages/ManagerPerformance.jsx';
import SalesPerformance from '@/pages/SalesPerformance.jsx';
import SalespersonReportBeta from '@/pages/SalespersonReportBeta.jsx';
import DispatchTrackReport from '@/pages/DispatchTrackReport.jsx';
import POScrubReport from '@/pages/POScrubReport.jsx';
import GrossMargin from '@/pages/GrossMargin.jsx';
import FloorSales from '@/pages/FloorSales.jsx';
import DmgSummary from '@/pages/DmgSummary.jsx';
import Disco from '@/pages/Disco.jsx';
import Leads from '@/pages/Leads.jsx';
import PendingReceivables from '@/pages/PendingReceivables.jsx';
import PickupNew from '@/pages/PickupNew.jsx';
import ZipAnalysis from '@/pages/ZipAnalysis.jsx';
import HotButtonIssues from '@/pages/HotButtonIssues.jsx';
import ServiceOrderNew from '@/pages/ServiceOrderNew.jsx';

// --- Forms ---
import AssociateManagerForm from '@/pages/forms/AssociateManagerForm.jsx';
import SalesPerformanceForm from '@/pages/forms/SalesPerformanceForm.jsx';
import ProspectiveBuyerForm from '@/pages/forms/ProspectiveBuyerForm.jsx';
import DamageForm from '@/pages/forms/DamageForm.jsx';
import InventoryRequestForm from '@/pages/forms/InventoryRequestForm.jsx';

// Path → element map. Anything not in here falls through to StubPage.
const built = {
  '/': <CPanel />,
  '/dashboard': <Dashboard />,
  '/admin': <Admin />,

  // Reports
  '/scr': <SCR />,
  '/item-sold-analysis': <ItemSoldAnalysis />,
  '/tracker': <TrackerReport />,
  '/mpr': <ManagerPerformance />,
  '/sales/performance': <SalesPerformance />,
  '/sales/report-beta': <SalespersonReportBeta />,
  '/dispatchtrack': <DispatchTrackReport />,
  '/po-scrub': <POScrubReport />,
  '/gmr': <GrossMargin />,
  '/fms': <FloorSales />,
  '/dmgsummary': <DmgSummary />,
  '/disco': <Disco />,
  '/leads': <Leads />,
  '/pendingReceivables': <PendingReceivables />,
  '/pickup/new': <PickupNew />,
  '/zip/analysis': <ZipAnalysis />,
  '/hot-button-issues': <HotButtonIssues />,
  '/service-order': <ServiceOrderNew />,

  // Forms
  '/mpf': <AssociateManagerForm />,
  '/spf': <SalesPerformanceForm />,
  '/pbf': <ProspectiveBuyerForm />,
  '/damage/create': <DamageForm />,
  '/mrf': <InventoryRequestForm />,
};

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {routes.map((r) => {
          const page = built[r.path] ?? <StubPage title={r.label} path={r.path} />;
          // Every route is guarded by path — direct-URL access by a role that
          // isn't permitted shows "Not authorized" (permissions are server-driven).
          return (
            <Route
              key={r.path}
              path={r.path}
              element={<RequireRoute path={r.path}>{page}</RequireRoute>}
            />
          );
        })}
        <Route
          path="*"
          element={
            <div className="p-10 text-center text-muted-fg">
              <h1 className="text-2xl font-semibold text-fg">404</h1>
              <p>Route not found.</p>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
