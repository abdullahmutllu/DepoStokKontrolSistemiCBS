import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { MapWorkspacePage } from "@/features/map/MapWorkspacePage";
import { WarehousesPage } from "@/features/warehouses/WarehousesPage";
import { WarehouseDetailPage } from "@/features/warehouses/WarehouseDetailPage";
import { ProductsPage } from "@/features/products/ProductsPage";
import { StockOpsPage } from "@/features/stock/StockOpsPage";
import { MovementsPage } from "@/features/stock/MovementsPage";
import { OrdersPage } from "@/features/orders/OrdersPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { AskPage } from "@/features/ai/AskPage";

// Subpath deploys (GitHub Pages demo) need the Vite base as router basename.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "map", element: <MapWorkspacePage /> },
      { path: "warehouses", element: <WarehousesPage /> },
      { path: "warehouses/:id", element: <WarehouseDetailPage /> },
      { path: "products", element: <ProductsPage /> },
      { path: "stock", element: <StockOpsPage /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "movements", element: <MovementsPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "ask", element: <AskPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
], { basename });
