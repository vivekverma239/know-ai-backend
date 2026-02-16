import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getAdminOrgs, getAdminSession } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useEffect } from "react";

export function AdminLayout() {
  const navigate = useNavigate();
  const accessToken = useAuthStore((state) => state.accessToken);
  const adminUserId = useAuthStore((state) => state.adminUserId);
  const clearSession = useAuthStore((state) => state.clearSession);

  const selectedOrgId = useOrgStore((state) => state.selectedOrgId);
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);

  const sessionQuery = useQuery({
    queryKey: ["admin-session", accessToken],
    queryFn: () => getAdminSession(accessToken ?? ""),
    enabled: Boolean(accessToken),
    retry: false,
  });

  const orgsQuery = useQuery({
    queryKey: ["admin-orgs", accessToken],
    queryFn: () => getAdminOrgs(accessToken ?? ""),
    enabled: Boolean(accessToken),
    retry: false,
  });

  useEffect(() => {
    if (sessionQuery.isError) {
      clearSession();
      navigate("/login", { replace: true });
    }
  }, [sessionQuery.isError, clearSession, navigate]);

  useEffect(() => {
    if (!orgsQuery.data?.items.length) return;
    if (!selectedOrgId) return;
    const selectedStillValid = orgsQuery.data.items.some((org) => org.orgId === selectedOrgId);
    if (!selectedStillValid) {
      setSelectedOrgId("");
    }
  }, [orgsQuery.data, selectedOrgId, setSelectedOrgId]);

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="brand-block">
          <p className="brand-kicker">Knowsis</p>
          <h1 className="brand-title">Admin Control Surface</h1>
        </div>

        <div className="topbar-controls">
          <label className="org-switcher" htmlFor="org-select">
            <span>Org Scope</span>
            <select
              id="org-select"
              value={selectedOrgId}
              onChange={(event) => setSelectedOrgId(event.target.value)}
              disabled={orgsQuery.isLoading}
            >
              <option value="">All Orgs</option>
              {orgsQuery.data?.items.map((org) => (
                <option key={org.orgId} value={org.orgId}>
                  {org.name ?? org.orgId}
                </option>
              ))}
            </select>
          </label>

          <div className="admin-profile">
            <span>{adminUserId ?? sessionQuery.data?.admin.userId ?? "admin"}</span>
            <button
              type="button"
              onClick={() => {
                clearSession();
                navigate("/login", { replace: true });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="admin-content-grid">
        <aside className="admin-sidebar">
          <NavLink
            to="/dashboard/documents"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            Documents
          </NavLink>
          <NavLink
            to="/dashboard/entities"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            Entities
          </NavLink>
        </aside>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
