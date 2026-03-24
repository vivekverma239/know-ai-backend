# Persist Selected Member in Playground

## Problem

The Playground page's user selection resets every time the user navigates away and comes back, requiring re-selection each time they want to test reports or chat.

## Solution

Move `selectedMemberId` from local `useState` in PlaygroundPage to the existing Zustand `orgStore`, persisted to localStorage. Clear it when `selectedOrgId` changes (different org = different members).

## Design

### orgStore changes

**File:** `admin-dashboard/src/store/orgStore.ts`

- Add `selectedMemberId: string` to state (persisted to localStorage under a new key)
- Add `setSelectedMemberId: (memberId: string) => void`
- When `setSelectedOrgId` is called, also clear `selectedMemberId` to `""`

### PlaygroundPage changes

**File:** `admin-dashboard/src/pages/PlaygroundPage.tsx`

- Replace `const [selectedMemberId, setSelectedMemberId] = useState("")` with `useOrgStore` selectors for `selectedMemberId` and `setSelectedMemberId`
- Remove unused `useState` import if no longer needed

## Files Changed

| File | Action |
|------|--------|
| `admin-dashboard/src/store/orgStore.ts` | Modify |
| `admin-dashboard/src/pages/PlaygroundPage.tsx` | Modify |
