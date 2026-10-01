import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import NotFound from "./pages/NotFound";

export function AppShell() {
  return (
    <>
      <nav>ReconHub</nav>
      <main style={{ paddingTop: 24 }}>
        <Outlet />
      </main>
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<div data-route="landing" />} />
        <Route path="/login" element={<div data-route="login" />} />
        <Route path="/dashboard" element={<div data-route="dashboard" />} />
        <Route path="/orders" element={<div data-route="orders" />} />
        <Route path="/orders/:id" element={<div data-route="order-detail" />} />
        <Route path="/parcels" element={<div data-route="parcels" />} />
        <Route
          path="/parcels/labels"
          element={<div data-route="parcel-labels" />}
        />
        <Route
          path="/parcels/test-sheet"
          element={<div data-route="parcel-test-sheet" />}
        />
        <Route
          path="/parcels/:barcode"
          element={<div data-route="parcel-detail" />}
        />
        <Route path="/scan" element={<div data-route="scan-hub" />} />
        <Route
          path="/scan/dispatch"
          element={<div data-route="scan-dispatch" />}
        />
        <Route path="/scan/return" element={<div data-route="return-scan" />} />
        <Route path="/scan/rto" element={<div data-route="rto-scan" />} />
        <Route path="/shipments" element={<div data-route="shipments" />} />
        <Route
          path="/shipments/outstanding"
          element={<div data-route="outstanding" />}
        />
        <Route
          path="/shipments/tracking"
          element={<div data-route="shipments-tracking" />}
        />
        <Route
          path="/shipments/:id"
          element={<div data-route="shipment-detail" />}
        />
        <Route path="/statements" element={<div data-route="statements" />} />
        <Route
          path="/statements/:id"
          element={<div data-route="statement-detail" />}
        />
        <Route
          path="/reports/monthly"
          element={<div data-route="monthly-report" />}
        />
        <Route path="/exceptions" element={<div data-route="exceptions" />} />
        <Route path="/import" element={<div data-route="import" />} />
        <Route
          path="/finance/close"
          element={<div data-route="finance-close" />}
        />
        <Route
          path="/finance/ledger"
          element={<div data-route="finance-ledger" />}
        />
        <Route path="/tracking" element={<div data-route="tracking" />} />
        <Route
          path="/settings/tally"
          element={<div data-route="tally-settings" />}
        />
        <Route
          path="/settings/costs"
          element={<div data-route="costs-settings" />}
        />
        <Route
          path="/settings/carriers"
          element={<div data-route="carriers-settings" />}
        />
        <Route path="/settings/sla" element={<div data-route="sla-settings" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
