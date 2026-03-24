import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAdminOrgs } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useOrgStore } from "@/store/orgStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminOrgItem } from "@/lib/types";

export function formatOrgLabel(org: AdminOrgItem) {
  if (org.name) return org.name;
  const id = org.orgId;
  return `Org (${id.slice(0, 4)}...${id.slice(-4)})`;
}

type OrgSwitcherModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mandatory?: boolean;
};

export function OrgSwitcherModal({ open, onOpenChange, mandatory = false }: OrgSwitcherModalProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setSelectedOrgId = useOrgStore((s) => s.setSelectedOrgId);
  const [search, setSearch] = useState("");

  const orgsQuery = useQuery({
    queryKey: ["admin-orgs", accessToken],
    queryFn: () => getAdminOrgs(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const filtered = useMemo(() => {
    const items = orgsQuery.data?.items ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (org) =>
        org.name?.toLowerCase().includes(q) ||
        org.orgId.toLowerCase().includes(q),
    );
  }, [orgsQuery.data, search]);

  const handleSelect = (orgId: string) => {
    setSelectedOrgId(orgId);
    setSearch("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={mandatory ? undefined : onOpenChange}>
      <DialogContent
        showCloseButton={!mandatory}
        onInteractOutside={mandatory ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={mandatory ? (e) => e.preventDefault() : undefined}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>
            {mandatory ? "Select an Organization" : "Switch Organization"}
          </DialogTitle>
          <DialogDescription>
            {mandatory
              ? "Choose an organization to get started."
              : "Switch to a different organization."}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search organizations..."
          autoFocus
        />

        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {orgsQuery.isLoading && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Loading organizations...
            </p>
          )}

          {orgsQuery.isError && (
            <div className="py-4 text-center space-y-2">
              <p className="text-sm text-destructive">Failed to load organizations.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => orgsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          )}

          {orgsQuery.data && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {search
                ? "No organizations match your search."
                : "No organizations available. Contact your administrator."}
            </p>
          )}

          {filtered.map((org) => (
            <button
              key={org.orgId}
              type="button"
              onClick={() => handleSelect(org.orgId)}
              className="w-full flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
            >
              <span className="truncate">{formatOrgLabel(org)}</span>
              <Badge variant="secondary" className="ml-2 text-[10px] shrink-0">
                {org.documentCount}
              </Badge>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
