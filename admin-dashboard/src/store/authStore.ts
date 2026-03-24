import { create } from "zustand";

const STORAGE_KEY = "knowsis_admin_session";

type StoredSession = {
  accessToken: string;
  adminUserId: string;
  expiresAt: string;
};

type AuthState = {
  accessToken: string | null;
  adminUserId: string | null;
  expiresAt: string | null;
  setSession: (session: StoredSession) => void;
  clearSession: () => void;
  isAuthenticated: () => boolean;
};

const readStoredSession = (): StoredSession | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.adminUserId || !parsed.expiresAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const initialSession = readStoredSession();

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: initialSession?.accessToken ?? null,
  adminUserId: initialSession?.adminUserId ?? null,
  expiresAt: initialSession?.expiresAt ?? null,
  setSession: (session) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
    set({
      accessToken: session.accessToken,
      adminUserId: session.adminUserId,
      expiresAt: session.expiresAt,
    });
  },
  clearSession: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    set({ accessToken: null, adminUserId: null, expiresAt: null });
  },
  isAuthenticated: () => {
    const { accessToken, expiresAt } = get();
    if (!accessToken || !expiresAt) return false;
    return new Date(expiresAt).getTime() > Date.now();
  },
}));
