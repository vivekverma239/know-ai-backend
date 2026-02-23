import { create } from "zustand";

const STORAGE_KEY = "knowsis_admin_selected_org";

type OrgState = {
  selectedOrgId: string;
  setSelectedOrgId: (orgId: string) => void;
};

const readInitialOrg = () => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
};

export const useOrgStore = create<OrgState>((set) => ({
  selectedOrgId: readInitialOrg(),
  setSelectedOrgId: (orgId) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, orgId);
    }
    set({ selectedOrgId: orgId });
  },
}));
