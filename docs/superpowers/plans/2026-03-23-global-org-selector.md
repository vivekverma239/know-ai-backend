# Global Org Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar org combobox with a mandatory modal-based org selector so all dashboard tabs are always scoped to a single org.

**Architecture:** Reuse the existing Zustand `orgStore` for selected org state. Create a new `OrgSwitcherModal` component using the existing Radix Dialog. Wire it into `AdminLayout` with mandatory mode (can't dismiss when no org selected) and switch mode (dismissable). Key the `<Outlet />` on `selectedOrgId` to remount child pages on org change. Simplify all tab pages by removing per-page org guards and redundant queries.

**Tech Stack:** React 19, TypeScript, Zustand, React Query, Radix Dialog, Tailwind CSS, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-23-global-org-selector-design.md`

---

### Task 1: Create OrgSwitcherModal component

**Files:**
- Create: `admin-dashboard/src/components/OrgSwitcherModal.tsx`

- [ ] **Step 1: Create OrgSwitcherModal component**

Create the modal with two modes: mandatory (non-dismissable) and switch (dismissable). It fetches orgs via the existing React Query cache, provides a search input to filter, and shows org rows with document count badges.

```tsx
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
```

- [ ] **Step 2: Verify the component builds**

Run: `cd admin-dashboard && npx tsc --noEmit`
Expected: No type errors related to OrgSwitcherModal

- [ ] **Step 3: Commit**

```bash
git add admin-dashboard/src/components/OrgSwitcherModal.tsx
git commit -m "feat(admin): add OrgSwitcherModal component with mandatory and switch modes"
```

---

### Task 2: Update AdminLayout — replace combobox with modal trigger

**Files:**
- Modify: `admin-dashboard/src/components/AdminLayout.tsx`

- [ ] **Step 1: Update imports**

Replace the Combobox imports and add Dialog/modal/icon imports. The new imports should be:

```tsx
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getAdminOrgs, getAdminSession } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";
import { OrgSwitcherModal, formatOrgLabel } from "./OrgSwitcherModal";
```

Remove these unused imports:
- `Badge` from `@/components/ui/badge`
- All `Combobox*` imports from `@/components/ui/combobox`
- `type { AdminOrgItem }` from `@/lib/types` (no longer needed — `formatOrgLabel` is now imported)

Also remove the local `formatOrgLabel` function definition (lines 19-23) since it's now imported from `OrgSwitcherModal`.

- [ ] **Step 2: Add modal state and update component body**

Inside `AdminLayout()`, after the existing `selectedOrgId`/`setSelectedOrgId` lines, add:

```tsx
const [orgModalOpen, setOrgModalOpen] = useState(false);
```

Keep the existing `sessionQuery`, `orgsQuery`, session error effect, and org validation effect unchanged.

Remove these lines (the combobox-related derived state):
- `const triggerLabel = ...` (line 65)
- `const orgOptions = [...]` (lines 67-74)
- `const orgLabelMap = ...` (line 76)
- `const valueToLabel = ...` (line 77)

Keep `formatOrgLabel` and `selectedOrg` — they're used for the trigger button label.

- [ ] **Step 3: Replace the sidebar Org Scope Picker section**

Remove the entire `{/* Org Scope Picker */}` div (lines 123-152).

In the bottom section (before `{/* Profile / Sign out */}`), add the org trigger button:

```tsx
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
```

- [ ] **Step 4: Add OrgSwitcherModal and key the Outlet**

At the end of the return, just before the closing `</div>`, add the modal:

```tsx
<OrgSwitcherModal
  open={orgModalOpen || !selectedOrgId}
  onOpenChange={setOrgModalOpen}
  mandatory={!selectedOrgId}
/>
```

Change `<Outlet />` (line 178) to:

```tsx
<Outlet key={selectedOrgId} />
```

- [ ] **Step 5: Verify the component builds**

Run: `cd admin-dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add admin-dashboard/src/components/AdminLayout.tsx
git commit -m "feat(admin): replace sidebar org combobox with modal trigger and mandatory org selection"
```

---

### Task 3: Simplify DocumentsPage — remove org column and redundant query

**Files:**
- Modify: `admin-dashboard/src/pages/DocumentsPage.tsx`

- [ ] **Step 1: Remove org-related imports and query**

Remove `getAdminOrgs` from the import on line 4 (keep `getAdminDocuments`).

Remove the entire `orgsQuery` block (lines 63-67):
```tsx
const orgsQuery = useQuery({
  queryKey: ["admin-orgs", accessToken],
  queryFn: () => getAdminOrgs(accessToken ?? ""),
  enabled: Boolean(accessToken),
});
```

Remove the `orgMap` useMemo (lines 69-76):
```tsx
const orgMap = useMemo(() => {
  ...
}, [orgsQuery.data]);
```

Remove the `useMemo` import if no longer needed (check — it's still used for `query`).

- [ ] **Step 2: Remove Org column from table**

Remove the `<TableHead>Org</TableHead>` (line 157).

Remove the Org table cell (line 170):
```tsx
<TableCell>{orgMap.get(doc.orgId) ?? doc.orgId}</TableCell>
```

- [ ] **Step 3: Ensure orgId is always passed in query**

The existing `query` memo already does `orgId: selectedOrgId || undefined`. Since org is now always present, this still works correctly — `selectedOrgId` will never be empty when the page renders.

- [ ] **Step 4: Verify build**

Run: `cd admin-dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add admin-dashboard/src/pages/DocumentsPage.tsx
git commit -m "refactor(admin): remove org column and redundant orgsQuery from DocumentsPage"
```

---

### Task 4: Simplify DocumentDetailPage — remove redundant orgsQuery

**Files:**
- Modify: `admin-dashboard/src/pages/DocumentDetailPage.tsx`

- [ ] **Step 1: Remove org-related code**

Remove `getAdminOrgs` from the import (line 13).

Remove the `orgsQuery` block (lines 394-398):
```tsx
const orgsQuery = useQuery({
  queryKey: ["admin-orgs", accessToken],
  queryFn: () => getAdminOrgs(accessToken ?? ""),
  enabled: Boolean(accessToken),
});
```

Remove the `orgName` useMemo (lines 434-440):
```tsx
const orgName = useMemo(() => {
  const orgId = detailQuery.data?.orgId;
  if (!orgId) return null;
  const org = orgsQuery.data?.items.find((o) => o.orgId === orgId);
  if (!org) return orgId;
  return org.name ?? `Org (${orgId.slice(0, 4)}...${orgId.slice(-4)})`;
}, [detailQuery.data?.orgId, orgsQuery.data]);
```

Update the reference at line 641 that uses `orgName`:
```tsx
// Before:
<span className="text-muted-foreground">{orgName ?? document.orgId}</span>
// After:
<span className="text-muted-foreground">{document.orgId}</span>
```

(The org name is no longer needed here since the user already knows which org they selected globally.)

- [ ] **Step 2: Verify build**

Run: `cd admin-dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add admin-dashboard/src/pages/DocumentDetailPage.tsx
git commit -m "refactor(admin): remove redundant orgsQuery from DocumentDetailPage"
```

---

### Task 5: Simplify EntitiesPage — remove org guard

**Files:**
- Modify: `admin-dashboard/src/pages/EntitiesPage.tsx`

- [ ] **Step 1: Remove the "no org selected" guard**

Remove the early return block (lines 58-67):
```tsx
if (!selectedOrgId) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="m-0 text-lg font-semibold">Entities</h2>
      </div>
      <p className="text-muted-foreground">Select an org scope from the sidebar to inspect entities.</p>
    </section>
  );
}
```

The page can now assume `selectedOrgId` is always present.

- [ ] **Step 2: Verify build**

Run: `cd admin-dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add admin-dashboard/src/pages/EntitiesPage.tsx
git commit -m "refactor(admin): remove org guard from EntitiesPage"
```

---

### Task 6: Simplify PlaygroundPage — remove org guard and redundant effect

**Files:**
- Modify: `admin-dashboard/src/pages/PlaygroundPage.tsx`

- [ ] **Step 1: Remove the "no org selected" guard**

Remove the early return block (lines 471-477):
```tsx
if (!selectedOrgId) {
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-muted-foreground">Select an organization from the sidebar to begin.</p>
    </div>
  );
}
```

- [ ] **Step 2: Remove the redundant selectedOrgId-change useEffect**

Remove the effect (lines 457-459):
```tsx
useEffect(() => {
  setSelectedMemberId("");
}, [selectedOrgId]);
```

This is now redundant because `<Outlet key={selectedOrgId} />` remounts the entire page on org switch, resetting all `useState` hooks.

- [ ] **Step 3: Verify build**

Run: `cd admin-dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add admin-dashboard/src/pages/PlaygroundPage.tsx
git commit -m "refactor(admin): remove org guard and redundant effect from PlaygroundPage"
```

---

### Task 7: Smoke test the full flow

- [ ] **Step 1: Build the project**

Run: `cd admin-dashboard && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Manual smoke test checklist**

Start the dev server and verify:
1. On fresh login (clear localStorage), the org modal appears and cannot be dismissed
2. After selecting an org, Documents tab loads and shows only that org's docs
3. The "Org" column is gone from the Documents table
4. Entities tab loads directly without a "select org" message
5. Playground tab loads directly without a "select org" message
6. Clicking the org button in the bottom-left sidebar opens the modal in switch mode (can be dismissed)
7. Switching org resets all tab state (page, search, filters)
8. The search filter in the modal works

- [ ] **Step 3: Final commit if any fixes needed**
