/**
 * Persistence provider interface and default implementations.
 *
 * The library defines the interface — consumers inject their own
 * implementation (GCS, Redis, S3, etc.).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Interface for persisting intermediate pipeline results.
 * Implement this to provide custom storage (GCS, Redis, S3, etc.).
 */
export interface PersistenceProvider {
  /** Get a cached value by key. Returns null if not found or expired. */
  get(key: string): Promise<string | null>;

  /** Set a cached value with optional TTL in seconds. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /** Check if a key exists. */
  exists(key: string): Promise<boolean>;

  /** Delete a key. */
  delete(key: string): Promise<void>;
}

/**
 * Local filesystem persistence (default).
 * Stores JSON files in a cache directory.
 */
export class LocalPersistence implements PersistenceProvider {
  private dir: string;

  constructor(cacheDir = ".cache") {
    this.dir = cacheDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(key: string): string {
    // Sanitize key for filesystem
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }

  async get(key: string): Promise<string | null> {
    const fp = this.filePath(key);
    try {
      const raw = fs.readFileSync(fp, "utf-8");
      const envelope = JSON.parse(raw);

      // Check TTL
      if (envelope.expiresAt && Date.now() > envelope.expiresAt) {
        fs.unlinkSync(fp);
        return null;
      }

      return envelope.value;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const envelope = {
      value,
      createdAt: Date.now(),
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    };
    fs.writeFileSync(this.filePath(key), JSON.stringify(envelope));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    try {
      fs.unlinkSync(this.filePath(key));
    } catch { /* not found */ }
  }
}

/** Compute a stable hash for a file (for cache keys). */
export function fileHash(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(buf).digest("hex");
}
