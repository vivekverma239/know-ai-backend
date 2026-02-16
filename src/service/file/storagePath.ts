import type { GoogleStorageService } from "@/service/googleStorage";

type PdfStorageTarget = {
  id: string;
  userId: string;
  orgId: string;
  isAdminFile?: boolean | null;
};

const dedupe = (values: string[]) => {
  return Array.from(new Set(values));
};

export const getPdfStoragePathCandidates = (target: PdfStorageTarget): string[] => {
  if (target.isAdminFile) {
    return dedupe([
      `files/admin/${target.orgId}/${target.id}/document.pdf`,
      `files/admin/${target.orgId}/${target.id}/${target.id}.pdf`,
    ]);
  }

  return dedupe([
    `files/${target.userId}/${target.id}/document.pdf`,
    `files/${target.userId}/${target.id}/${target.id}.pdf`,
  ]);
};

export const resolveExistingPdfStoragePath = async (
  storage: GoogleStorageService,
  target: PdfStorageTarget,
): Promise<string | null> => {
  const candidates = getPdfStoragePathCandidates(target);
  for (const candidate of candidates) {
    if (await storage.exists(candidate)) {
      return candidate;
    }
  }
  return null;
};

