import { logger } from "@/utils/logger";
import type { GoogleStorageService } from "@/service/googleStorage";

// In-memory cache for resolved storage paths (TTL: 5 minutes)
const pathCache = new Map<string, { path: string; expiresAt: number }>();
const PATH_CACHE_TTL_MS = 5 * 60 * 1000;

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
  // Check cache first
  const cached = pathCache.get(target.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.path;
  }

  const candidates = getPdfStoragePathCandidates(target);
  for (const candidate of candidates) {
    if (await storage.exists(candidate)) {
      pathCache.set(target.id, { path: candidate, expiresAt: Date.now() + PATH_CACHE_TTL_MS });
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
      pathCache.set(target.id, { path: discoveredPath, expiresAt: Date.now() + PATH_CACHE_TTL_MS });
      return discoveredPath;
    }
  }

  return null;
};

export const invalidateStoragePathCache = (fileId: string) => {
  pathCache.delete(fileId);
};

/**
 * Download the PDF buffer for a file, falling back to sourceDocumentUrl if
 * the file is missing from GCS. When the fallback is used the PDF is
 * re-uploaded to GCS so subsequent attempts find it directly.
 */
export const downloadPdfBuffer = async (
  storage: GoogleStorageService,
  file: PdfStorageTarget & { sourceDocumentUrl?: string | null },
): Promise<Buffer> => {
  const gcsPath = await resolveExistingPdfStoragePath(storage, file);

  if (gcsPath) {
    return storage.downloadFile(gcsPath);
  }

  if (file.sourceDocumentUrl && /^https?:\/\//i.test(file.sourceDocumentUrl)) {
    logger.warn("PDF not in GCS, falling back to sourceDocumentUrl", {
      fileId: file.id,
      sourceDocumentUrl: file.sourceDocumentUrl,
    });

    const res = await fetch(file.sourceDocumentUrl);
    if (!res.ok) {
      throw new Error(`Failed to download PDF from source URL (${res.status}): ${file.id}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    // Re-upload so future lookups find it in GCS
    const uploadPath = file.isAdminFile
      ? `files/admin/${file.orgId}/${file.id}/document.pdf`
      : `files/${file.userId}/${file.id}/document.pdf`;
    await storage.uploadFile({ data: buffer, contentType: "application/pdf", path: uploadPath });
    logger.info("Re-uploaded PDF to GCS from source URL", { fileId: file.id, uploadPath });

    return buffer;
  }

  throw new Error(`PDF not found in storage: ${file.id}`);
};
