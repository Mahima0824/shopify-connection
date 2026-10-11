import { Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import Loading from "./components/Loading";
import NotFound from "./pages/NotFound";
import TopNav from "./components/TopNav";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import CreateOrder from "./pages/CreateOrder";
import Exceptions from "./pages/Exceptions";
import Parcels from "./pages/Parcels";
import ParcelDetail from "./pages/ParcelDetail";
import ParcelLabels from "./pages/ParcelLabels";
import ParcelTestSheet from "./pages/ParcelTestSheet";
import ShipmentHistory from "./pages/ShipmentHistory";
import Outstanding from "./pages/Outstanding";
import StatementList from "./pages/StatementList";
import StatementDetail from "./pages/StatementDetail";
import MonthlyReport from "./pages/MonthlyReport";
import TallySettings from "./pages/TallySettings";
import CostsSettings from "./pages/CostsSettings";
import CarriersSettings from "./pages/CarriersSettings";
import SlaSettings from "./pages/SlaSettings";
import FinanceClose from "./pages/FinanceClose";
import FinanceLedger from "./pages/FinanceLedger";
import Tracking from "./pages/Tracking";
import ShipmentsTracking from "./pages/ShipmentsTracking";
import RtoManagement from "./pages/RtoManagement";
import CodRemittance from "./pages/CodRemittance";
import ServerError from "./pages/ServerError";
import Maintenance from "./pages/Maintenance";
import { ThemeProvider } from "./context/ThemeContext";

import Footer from "./components/Footer";
import ScrollToTop from "./components/ScrollToTop";

/* Auth routes stand alone: no nav, no footer, no shell padding. Signing in is
   a focused task and the app nav only offers destinations that still need a
   session. Paths live in one place so a new /signup is a one-line change. */
const BARE_ROUTES = ["/login", "/signup"];

export function AppShell() {
  const { pathname } = useLocation();
  const bare = BARE_ROUTES.includes(pathname);

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground antialiased flex flex-col">
        <ScrollToTop />
        {!bare && <TopNav />}
        <main className={bare ? "flex-1" : "flex-1 pb-16 pt-6"}>
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
        {!bare && <Footer />}
      </div>
    </ThemeProvider>
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
        <Route path="/orders/new" element={<CreateOrder />} />
        <Route path="/create-order" element={<CreateOrder />} />
        <Route path="/rto" element={<RtoManagement />} />
        <Route path="/cod-remittance" element={<CodRemittance />} />
        <Route path="/orders/:id" element={<Navigate to="/orders" replace />} />
        <Route path="/parcels" element={<Parcels />} />
        <Route path="/parcels/labels" element={<ParcelLabels />} />
        <Route path="/parcels/test-sheet" element={<ParcelTestSheet />} />
        <Route path="/parcels/:barcode" element={<ParcelDetail />} />
        <Route path="/shipments/outstanding" element={<Outstanding />} />
        <Route path="/shipments/tracking" element={<ShipmentsTracking />} />
        <Route path="/shipments/:id" element={<ShipmentHistory />} />
        <Route path="/statements" element={<StatementList />} />
        <Route path="/statements/:id" element={<StatementDetail />} />
        <Route path="/reports/monthly" element={<MonthlyReport />} />
        <Route path="/exceptions" element={<Exceptions />} />
        <Route path="/finance/close" element={<FinanceClose />} />
        <Route path="/finance/ledger" element={<FinanceLedger />} />
        <Route path="/tracking" element={<Tracking />} />
        <Route path="/settings/tally" element={<TallySettings />} />
        <Route path="/settings/costs" element={<CostsSettings />} />
        <Route path="/settings/carriers" element={<CarriersSettings />} />
        <Route path="/settings/sla" element={<SlaSettings />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/503" element={<Maintenance />} />
        <Route path="/500" element={<ServerError />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
