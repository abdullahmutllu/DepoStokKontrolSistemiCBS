import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Boxes,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  MessageSquareText,
  Package,
  PieChart,
  Warehouse as WarehouseIcon,
  X,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { loggedOut } from "@/features/auth/authSlice";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Genel Bakış", icon: LayoutDashboard, end: true },
  { to: "/map", label: "Harita", icon: MapIcon },
  { to: "/warehouses", label: "Depolar", icon: WarehouseIcon },
  { to: "/products", label: "Ürünler", icon: Package },
  { to: "/stock", label: "Stok İşlemleri", icon: ArrowLeftRight },
  { to: "/movements", label: "Hareketler", icon: Boxes },
  { to: "/reports", label: "Raporlar", icon: PieChart },
  { to: "/ask", label: "Asistan", icon: MessageSquareText },
];

export function AppShell() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const [mobileOpen, setMobileOpen] = useState(false);

  const logout = () => {
    dispatch(loggedOut());
    navigate("/login");
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3" aria-label="Ana menü">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] transition-colors",
              isActive
                ? "bg-accent/12 font-medium text-accent"
                : "text-text-muted hover:bg-ink-700 hover:text-text",
            )
          }
        >
          <Icon size={15} strokeWidth={1.75} />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-ink-600 bg-ink-850 md:flex">
        <div className="flex items-center gap-2 border-b border-ink-600 px-3 py-3">
          <span className="flex size-7 items-center justify-center rounded bg-accent/15 text-accent">
            <Boxes size={16} strokeWidth={1.75} />
          </span>
          <div className="font-display text-[13.5px] font-semibold leading-none">Depo Konsolu</div>
        </div>
        {nav}
        <div className="border-t border-ink-600 p-2">
          <div className="truncate px-2 pb-1 text-[11px] text-text-faint">{user?.email}</div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-text-muted hover:bg-ink-700 hover:text-text"
          >
            <LogOut size={14} /> Oturumu kapat
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink-950/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-60 flex-col border-r border-ink-600 bg-ink-850">
            <div className="flex items-center justify-between border-b border-ink-600 px-3 py-3">
              <div className="font-display text-sm font-semibold">Depo Konsolu</div>
              <button onClick={() => setMobileOpen(false)} aria-label="Menüyü kapat" className="text-text-muted">
                <X size={16} />
              </button>
            </div>
            {nav}
            <div className="border-t border-ink-600 p-2">
              <button
                onClick={logout}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-text-muted hover:bg-ink-700"
              >
                <LogOut size={14} /> Oturumu kapat
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between gap-3 border-b border-ink-600 bg-ink-850/60 px-3 md:px-5">
          <button
            className="text-text-muted md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Menüyü aç"
          >
            <Menu size={18} />
          </button>
          <div className="mono hidden text-[11px] uppercase tracking-widest text-text-faint md:block">
            stok · mekân · kontrol
          </div>
          <NotificationBell />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
