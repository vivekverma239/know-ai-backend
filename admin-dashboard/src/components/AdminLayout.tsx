import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getAdminOrgs, getAdminSession } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";
import { OrgSwitcherModal, formatOrgLabel } from "./OrgSwitcherModal";

export function AdminLayout() {
  const navigate = useNavigate();
  const accessToken = useAuthStore((state) => state.accessToken);
  const adminUserId = useAuthStore((state) => state.adminUserId);
  const clearSession = useAuthStore((state) => state.clearSession);

  const selectedOrgId = useOrgStore((state) => state.selectedOrgId);
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);

  const [orgModalOpen, setOrgModalOpen] = useState(false);

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

  const selectedOrg = orgsQuery.data?.items.find((org) => org.orgId === selectedOrgId);

  return (
    <div className="min-h-screen flex p-3 md:p-4 gap-3">
      {/* Sidebar with everything */}
      <aside className="w-[220px] shrink-0 border border-border rounded-xl bg-card p-3 flex flex-col gap-3 max-h-screen sticky top-4 overflow-y-auto">
        {/* Brand */}
        <div className="px-1">
          <p className="m-0 uppercase tracking-[0.14em] text-primary text-xs font-bold">Knowsis</p>
          <h1 className="m-0 mt-0.5 font-heading text-2xl tracking-wide leading-none">Admin</h1>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-1">
          <NavLink to="/dashboard/documents" className="contents">
            {({ isActive }: { isActive: boolean }) => (
              <Button
                variant={isActive ? "default" : "ghost"}
                className="w-full justify-start"
              >
                Documents
              </Button>
            )}
          </NavLink>
          <NavLink to="/dashboard/entities" className="contents">
            {({ isActive }: { isActive: boolean }) => (
              <Button
                variant={isActive ? "default" : "ghost"}
                className="w-full justify-start"
              >
                Entities
              </Button>
            )}
          </NavLink>
          <NavLink to="/dashboard/playground" className="contents">
            {({ isActive }: { isActive: boolean }) => (
              <Button
                variant={isActive ? "default" : "ghost"}
                className="w-full justify-start"
              >
                Playground
              </Button>
            )}
          </NavLink>
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Org Switcher Trigger */}
        <div className="border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between text-left h-auto py-2"
            onClick={() => setOrgModalOpen(true)}
          >
            <span className="truncate text-xs">
              {selectedOrg ? formatOrgLabel(selectedOrg) : "Select Org"}
            </span>
            <ArrowLeftRight className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </div>

        {/* Profile / Sign out */}
        <div className="border-t border-border pt-3 space-y-2">
          <p className="m-0 text-xs text-muted-foreground truncate px-1">
            {adminUserId ?? sessionQuery.data?.admin.userId ?? "admin"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              clearSession();
              navigate("/login", { replace: true });
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 border border-border rounded-xl bg-card p-4 min-w-0">
        <Outlet key={selectedOrgId} />
      </main>

      <OrgSwitcherModal
        open={orgModalOpen || !selectedOrgId}
        onOpenChange={setOrgModalOpen}
        mandatory={!selectedOrgId}
      />
    </div>
  );
}
