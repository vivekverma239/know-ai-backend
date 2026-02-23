import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getAdminOrgs, getAdminSession } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import type { AdminOrgItem } from "@/lib/types";

function formatOrgLabel(org: AdminOrgItem) {
  if (org.name) return org.name;
  const id = org.orgId;
  return `Org (${id.slice(0, 4)}...${id.slice(-4)})`;
}

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

  const selectedOrg = orgsQuery.data?.items.find((org) => org.orgId === selectedOrgId);
  const triggerLabel = selectedOrg ? formatOrgLabel(selectedOrg) : "All Orgs";

  const orgOptions = [
    { value: "", label: "All Orgs", count: null },
    ...(orgsQuery.data?.items.map((org) => ({
      value: org.orgId,
      label: formatOrgLabel(org),
      count: org.documentCount,
    })) ?? []),
  ];

  const orgLabelMap = new Map(orgOptions.map((o) => [o.value, o.label]));
  const valueToLabel = (value: string) => orgLabelMap.get(value) ?? value;

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
            {({ isActive }) => (
              <Button
                variant={isActive ? "default" : "ghost"}
                className="w-full justify-start"
              >
                Documents
              </Button>
            )}
          </NavLink>
          <NavLink to="/dashboard/entities" className="contents">
            {({ isActive }) => (
              <Button
                variant={isActive ? "default" : "ghost"}
                className="w-full justify-start"
              >
                Entities
              </Button>
            )}
          </NavLink>
          <NavLink to="/dashboard/playground" className="contents">
            {({ isActive }) => (
              <Button
                variant={isActive ? "default" : "ghost"}
                className="w-full justify-start"
              >
                Playground
              </Button>
            )}
          </NavLink>
        </nav>

        {/* Org Scope Picker */}
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-medium px-1">Org Scope</span>
          <Combobox
            value={selectedOrgId}
            onValueChange={(val) => setSelectedOrgId(val ?? "")}
            itemToStringLabel={valueToLabel}
          >
            <ComboboxInput
              placeholder={triggerLabel}
              disabled={orgsQuery.isLoading}
              className="w-full"
            />
            <ComboboxContent>
              <ComboboxList>
                <ComboboxEmpty>No org found.</ComboboxEmpty>
                {orgOptions.map((org) => (
                  <ComboboxItem key={org.value} value={org.value}>
                    <span className="flex-1 truncate">{org.label}</span>
                    {org.count !== null ? (
                      <Badge variant="secondary" className="ml-auto text-[10px]">
                        {org.count}
                      </Badge>
                    ) : null}
                  </ComboboxItem>
                ))}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

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
        <Outlet />
      </main>
    </div>
  );
}
