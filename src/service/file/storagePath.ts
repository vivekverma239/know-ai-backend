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

const getUserPdfStoragePathCandidates = (target: PdfStorageTarget): string[] => {
  return [
    `files/${target.userId}/${target.id}/document.pdf`,
    `files/${target.userId}/${target.id}/${target.id}.pdf`,
  ];
};

const getAdminPdfStoragePathCandidates = (target: PdfStorageTarget): string[] => {
  return [
    `files/admin/${target.orgId}/${target.id}/document.pdf`,
    `files/admin/${target.orgId}/${target.id}/${target.id}.pdf`,
  ];
};

export const getPdfStoragePathCandidates = (target: PdfStorageTarget): string[] => {
  const primary = target.isAdminFile
    ? getAdminPdfStoragePathCandidates(target)
    : getUserPdfStoragePathCandidates(target);
  const secondary = target.isAdminFile
    ? getUserPdfStoragePathCandidates(target)
    : getAdminPdfStoragePathCandidates(target);

  // Include both families so preview/parsing still works for legacy rows where
  // isAdminFile/userId metadata does not match the actual storage prefix.
  return dedupe([...primary, ...secondary]);
};

const isPdfPath = (path: string) => /\.pdf$/i.test(path);

const pickPreferredPdfPath = (paths: string[], targetId: string): string | null => {
  const uniquePdfPaths = dedupe(paths.filter(isPdfPath));
  if (uniquePdfPaths.length === 0) return null;

  const documentPath = uniquePdfPaths.find((path) => path.endsWith("/document.pdf"));
  if (documentPath) return documentPath;

  const idPath = uniquePdfPaths.find((path) => path.endsWith(`/${targetId}.pdf`));
  if (idPath) return idPath;

  return uniquePdfPaths[0] ?? null;
};

const discoverPdfPathByPrefix = async (
  storage: GoogleStorageService,
  prefix: string,
  targetId: string,
): Promise<string | null> => {
  try {
    const files = await storage.listFiles(prefix);
    const filePaths = files.map((file) => file.name).filter((name) => name.startsWith(prefix));
    return pickPreferredPdfPath(filePaths, targetId);
  } catch {
    return null;
  }
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

  const prefixes = dedupe([
    `files/${target.userId}/${target.id}/`,
    `files/admin/${target.orgId}/${target.id}/`,
  ]);

  for (const prefix of prefixes) {
    const discoveredPath = await discoverPdfPathByPrefix(storage, prefix, target.id);
    if (discoveredPath) {
      return discoveredPath;
    }
  }

  return null;
};
