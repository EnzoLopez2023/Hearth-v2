import { useEffect, useState, type ReactNode } from "react";
import { Activity, Home, LayoutDashboard, Map } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { domains } from "./features/resources/domain-config";
import { ResourceWorkspace } from "./features/resources/ResourceWorkspace";

interface Version {
  version: string;
  source_sha: string;
}

function AppShell({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<Version | null>(null);
  useEffect(() => {
    api<Version>("/api/version").then(setVersion).catch(() => undefined);
  }, []);

  const links = [{ slug: "", label: "Today", coordinate: "T–00", icon: LayoutDashboard }, ...domains];
  return (
    <div className="fieldbook-shell">
      <aside className="site-legend">
        <header className="wordmark">
          <div className="property-mark"><Home aria-hidden="true" /></div>
          <div><b>HEARTH</b><span>PROPERTY FIELDBOOK</span></div>
        </header>
        <div className="legend-title"><Map aria-hidden="true" /> Site legend</div>
        <nav aria-label="Property sections">
          {links.map(({ slug, label, coordinate, icon: Icon }) => (
            <NavLink key={slug || "today"} to={`/${slug}`} end={!slug}>
              <span className="nav-coordinate">{coordinate}</span>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <footer>
          <div className="system-state"><Activity aria-hidden="true" /><span>Local record<b>Ready when authenticated</b></span></div>
          <div className="build-stamp"><span>{version?.version ?? "build pending"}</span><code>{version?.source_sha?.slice(0, 8) ?? "local"}</code></div>
        </footer>
      </aside>
      <div className="mobile-mast">
        <div className="wordmark"><div className="property-mark"><Home aria-hidden="true" /></div><div><b>HEARTH</b><span>FIELD FOLIO</span></div></div>
        <span className="mobile-status"><Activity aria-hidden="true" /> Property record</span>
      </div>
      {children}
      <nav className="mobile-index" aria-label="Property index">
        {links.map(({ slug, label, icon: Icon }) => (
          <NavLink key={slug || "today"} to={`/${slug}`} end={!slug}>
            <Icon aria-hidden="true" /><span>{label.replace(" maintenance", "").replace(" manager", "").replace("Home ", "")}</span>
          </NavLink>
        ))}
      </nav>
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
