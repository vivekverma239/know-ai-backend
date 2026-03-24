import { create } from "zustand";

const ORG_STORAGE_KEY = "knowsis_admin_selected_org";
const MEMBER_STORAGE_KEY = "knowsis_admin_selected_member";

type OrgState = {
  selectedOrgId: string;
  setSelectedOrgId: (orgId: string) => void;
  selectedMemberId: string;
  setSelectedMemberId: (memberId: string) => void;
};

const readInitial = (key: string) => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
};

export const useOrgStore = create<OrgState>((set) => ({
  selectedOrgId: readInitial(ORG_STORAGE_KEY),
  selectedMemberId: readInitial(MEMBER_STORAGE_KEY),
  setSelectedOrgId: (orgId) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ORG_STORAGE_KEY, orgId);
      window.localStorage.removeItem(MEMBER_STORAGE_KEY);
    }
    set({ selectedOrgId: orgId, selectedMemberId: "" });
  },
  setSelectedMemberId: (memberId) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MEMBER_STORAGE_KEY, memberId);
    }
    set({ selectedMemberId: memberId });
  },
}));
