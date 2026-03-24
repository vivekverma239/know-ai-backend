# Global Org Selector for Admin Dashboard

## Problem

The admin dashboard has inconsistent org scoping. Documents tab treats org as optional (shows all orgs by default), while Entities and Playground tabs require an org and show placeholder messages. The org combobox in the sidebar allows "All Orgs" which leads to mixed behavior across tabs.

## Solution

Make org selection mandatory and global. Replace the sidebar combobox with a modal-based org switcher triggered from a button in the bottom-left of the sidebar. All tabs always operate within the context of the selected org.

## Approach

Approach A: Modal + existing Zustand store. Reuse the `orgStore` as the source of truth. Swap the sidebar combobox for a modal trigger + `OrgSwitcherModal` component.

## Design

### 1. OrgSwitcherModal Component

**New file:** `admin-dashboard/src/components/OrgSwitcherModal.tsx`

- Dialog/modal fetching orgs via `getAdminOrgs`
- Search input at top, filters orgs by name
- Org rows show: org name + document count badge
- On click: sets `selectedOrgId`, closes modal
- **Two modes:**
  - **Mandatory mode** (no org selected): opens automatically, cannot be dismissed (no close button, no click-outside, no escape)
  - **Switch mode** (triggered from sidebar): can be dismissed normally
- Uses existing `DialogContent`'s `showCloseButton={false}` prop plus Radix's `onInteractOutside` / `onEscapeKeyDown` event prevention for mandatory mode. No custom modal needed.
- **Loading state:** Shows a spinner/loading message while `getAdminOrgs` is fetching
- **Error state:** Shows error message with a retry button (critical in mandatory mode where the user cannot dismiss)
- **Empty list:** Shows a message like "No organizations available. Contact your administrator."

### 2. AdminLayout Changes

**File:** `admin-dashboard/src/components/AdminLayout.tsx`

- Remove the "Org Scope Picker" combobox section
- Add org switcher trigger button in bottom-left (above profile/sign-out):
  - Shows current org name + swap icon
  - Click opens `OrgSwitcherModal` in switch mode
- On mount: if `selectedOrgId` is empty, open modal in mandatory mode
- **Org removed from list:** The existing validation effect that checks whether `selectedOrgId` still exists in the orgs list will call `setSelectedOrgId("")` if removed. This re-triggers the mandatory modal, so the user is prompted to pick a new org. `setSelectedOrgId("")` remains valid as the mechanism to force mandatory mode.
- Key `<Outlet />` on `selectedOrgId` (`<Outlet key={selectedOrgId} />`) so all child pages remount on org switch, naturally resetting local state (search, filters, pagination)

### 3. Tab Page Changes

**DocumentsPage:**
- Remove `orgsQuery` fetch and `orgMap` lookup
- Remove "Org" column from the table
- `orgId` in query always comes from `selectedOrgId`

**DocumentDetailPage:**
- Remove its own `orgsQuery` fetch and `orgName` lookup — org context is globally known
- On org switch, the `<Outlet key={selectedOrgId} />` remount will reset this page. Since the document being viewed may not belong to the new org, the remount naturally returns the user to a fresh state; the page will simply fail to load the stale document ID from the URL, which the existing error handling covers.

**EntitiesPage:**
- Remove the "no org selected" guard/message

**PlaygroundPage:**
- Remove the "no org selected" guard/message
- Remove the `selectedOrgId`-change `useEffect` that resets `selectedMemberId` — redundant since `<Outlet key={selectedOrgId} />` remounts the page, naturally resetting all `useState` hooks

All tabs can assume an org is always present.

## Files Changed

| File | Action |
|------|--------|
| `admin-dashboard/src/components/OrgSwitcherModal.tsx` | Create |
| `admin-dashboard/src/components/AdminLayout.tsx` | Modify |
| `admin-dashboard/src/pages/DocumentsPage.tsx` | Modify |
| `admin-dashboard/src/pages/DocumentDetailPage.tsx` | Modify |
| `admin-dashboard/src/pages/EntitiesPage.tsx` | Modify |
| `admin-dashboard/src/pages/PlaygroundPage.tsx` | Modify |
