import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import NotFound from "./pages/NotFound";
import TopNav from "./components/TopNav";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Exceptions from "./pages/Exceptions";
import Parcels from "./pages/Parcels";
import ParcelDetail from "./pages/ParcelDetail";
import ParcelLabels from "./pages/ParcelLabels";
import ParcelTestSheet from "./pages/ParcelTestSheet";
import ScanHub from "./pages/ScanHub";
import Dispatch from "./pages/Dispatch";
import ReturnScan from "./pages/ReturnScan";
import RtoScan from "./pages/RtoScan";
import Shipments from "./pages/Shipments";
import ShipmentDetail from "./pages/ShipmentDetail";
import Outstanding from "./pages/Outstanding";

export function AppShell() {
  return (
    <>
      <TopNav />
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
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/parcels" element={<Parcels />} />
        <Route path="/parcels/labels" element={<ParcelLabels />} />
        <Route path="/parcels/test-sheet" element={<ParcelTestSheet />} />
        <Route path="/parcels/:barcode" element={<ParcelDetail />} />
        <Route path="/scan" element={<ScanHub />} />
        <Route path="/scan/dispatch" element={<Dispatch />} />
        <Route path="/scan/return" element={<ReturnScan />} />
        <Route path="/scan/rto" element={<RtoScan />} />
        <Route path="/shipments" element={<Shipments />} />
        <Route path="/shipments/outstanding" element={<Outstanding />} />
        <Route
          path="/shipments/tracking"
          element={<div data-route="shipments-tracking" />}
        />
        <Route path="/shipments/:id" element={<ShipmentDetail />} />
        <Route path="/statements" element={<div data-route="statements" />} />
        <Route
          path="/statements/:id"
          element={<div data-route="statement-detail" />}
        />
        <Route
          path="/reports/monthly"
          element={<div data-route="monthly-report" />}
        />
        <Route path="/exceptions" element={<Exceptions />} />
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
