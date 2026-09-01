import { useEffect, useState, type ReactNode } from "react";
import { Activity, ChevronDown, Home, Menu, Moon, Sun, X } from "lucide-react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { domains } from "./features/resources/domain-config";
import { ResourceWorkspace } from "./features/resources/ResourceWorkspace";

interface Version {
  version: string;
  source_sha: string;
}

type ThemeMode = "light" | "dark";

function AppShell({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<Version | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("ws-theme-mode");
    return saved === "dark" ? "dark" : "light";
  });
  const location = useLocation();

  useEffect(() => {
    api<Version>("/api/version").then(setVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ws-theme-mode", theme);
  }, [theme]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const page = location.pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const homeDomains = domains.filter((domain) => domain.slug !== "recipes");
  const kitchenDomains = domains.filter((domain) => domain.slug === "recipes");
  const toggleTheme = () => setTheme((current) => current === "light" ? "dark" : "light");

  return (
    <div className="hearth-shell" data-page={page} data-theme={theme}>
      <div className="page-backdrop" aria-hidden="true" />
      <button className="floating-control mobile-menu-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation menu">
        <Menu aria-hidden="true" />
      </button>
      <button className="floating-control mobile-theme-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
        {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </button>
      {mobileOpen && <button className="drawer-scrim" type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu" />}

      <aside className={`hearth-sidebar${mobileOpen ? " is-open" : ""}`}>
        <button className="sidebar-close" type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu">
          <X aria-hidden="true" />
        </button>
        <header className="wordmark">
          <img src="/favicon.svg" alt="" aria-hidden="true" />
          <div className="brand-copy">
            <div>
              <strong>Hearth</strong>
              <button className="inline-theme-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
                {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              </button>
            </div>
            <span>the home you keep</span>
          </div>
        </header>

        <nav className="hearth-nav" aria-label="Hearth sections">
          <NavLink className="nav-home" to="/" end>
            <Home aria-hidden="true" />
            <span>Home</span>
          </NavLink>

          <div className="nav-group">
            <div className="nav-group-heading"><i aria-hidden="true" /><span>Home &amp; property</span><ChevronDown aria-hidden="true" /></div>
            {homeDomains.map(({ slug, label }) => (
              <NavLink className="nav-item" key={slug} to={`/${slug}`}>
                <span>{label}</span>
              </NavLink>
            ))}
          </div>

          <div className="nav-group">
            <div className="nav-group-heading"><i aria-hidden="true" /><span>Kitchen</span><ChevronDown aria-hidden="true" /></div>
            {kitchenDomains.map(({ slug, label }) => (
              <NavLink className="nav-item" key={slug} to={`/${slug}`}>
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        <footer className="sidebar-footer">
          <div className="build-stamp"><span>{version?.version ?? "local build"}</span><code>{version?.source_sha?.slice(0, 8) ?? "local"}</code></div>
          <div className="account-tile">
            <span className="account-avatar">H2</span>
            <span>Hearth-v2<small>Household record</small></span>
            <Activity aria-label="Ready" />
          </div>
        </footer>
      </aside>

      <div className="page-frame">{children}</div>
    </div>
  );
}

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/:domain" element={<ResourceWorkspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
