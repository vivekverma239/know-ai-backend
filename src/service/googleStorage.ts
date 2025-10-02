import { Storage, Bucket, File } from "@google-cloud/storage";
import fs from "fs";

export class GoogleStorageService {
  private readonly bucket: Bucket;
  private readonly storage: Storage;

  constructor() {
    this.storage = new Storage({
      credentials: JSON.parse(
        process.env.GOOGLE_APPLICATION_CREDENTIALS!
          ? fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS!)
          : JSON.parse(
              Buffer.from(
                process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64!,
                "base64"
              ).toString("utf-8")
            )
      ),
    });
    this.bucket = this.storage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME!);
  }

  /**
   * Upload a file to Google Cloud Storage
   */
  async uploadFile(params: {
    data: Buffer | string;
    contentType?: string;
    path: string;
  }) {
    const { data, contentType, path } = params;
    const file = this.bucket.file(path);

    const buffer =
      typeof data === "string" ? Buffer.from(data, "base64") : data;

    console.log("ContentType", contentType);

    try {
      await file.save(buffer, {
        metadata: {
          contentType: contentType || "application/octet-stream",
        },
      });
      return path;
    } catch (error) {
      console.error("Error uploading to Google Cloud Storage:", error);
      throw new Error("Failed to upload file");
    }
  }

  /**
   * Download a file from Google Cloud Storage
   */
  async downloadFile(key: string): Promise<Buffer> {
    const file = this.bucket.file(key);

    try {
      const [data] = await file.download();
      return data;
    } catch (error) {
      console.error("Error downloading from Google Cloud Storage:", error);
      throw new Error("Failed to download file");
    }
  }

  /**
   * Delete a file from Google Cloud Storage
   */
  async deleteFile(key: string): Promise<void> {
    const file = this.bucket.file(key);

    try {
      await file.delete();
    } catch (error) {
      console.error("Error deleting from Google Cloud Storage:", error);
      throw new Error("Failed to delete file");
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(prefix?: string): Promise<File[]> {
    try {
      const [files] = await this.bucket.getFiles({
        prefix: prefix,
      });
      return files;
    } catch (error) {
      console.error("Error listing files from Google Cloud Storage:", error);
      throw new Error("Failed to list files");
    }
  }

  /**
   * Generate a signed URL for temporary access to a file
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const file = this.bucket.file(key);

    try {
      const [signedUrl] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expiresIn * 1000,
      });
      return signedUrl;
    } catch (error) {
      const err = error as Error;
      console.error("Error generating signed URL:", err.message);
      throw new Error("Failed to generate signed URL");
    }
  }

  async getSignedUploadUrl(key: string, expiresIn = 3600): Promise<string> {
    const file = this.bucket.file(key);

    try {
      const [signedUrl] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + expiresIn * 1000,
        contentType: "application/octet-stream",
      });
      return signedUrl;
    } catch (error) {
      const err = error as Error;
      console.error("Error generating signed URL:", err.message);
      throw new Error("Failed to generate signed URL");
    }
  }

  async getFile(key: string): Promise<Buffer> {
    const file = this.bucket.file(key);

    try {
      const [data] = await file.download();
      return data;
    } catch (error) {
      console.error("Error getting file from Google Cloud Storage:", error);
      throw new Error("Failed to get file");
    }
  }

  /**
   * Check if a file exists in Storage
   */
  async exists(key: string): Promise<boolean> {
    const file = this.bucket.file(key);
    try {
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      return false;
    }
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    const sourceFile = this.bucket.file(sourcePath);
    const targetFile = this.bucket.file(targetPath);

    try {
      await sourceFile.copy(targetFile);
    } catch (error) {
      console.error("Error copying file in Google Cloud Storage:", error);
      throw new Error("Failed to copy file");
    }
  }

  async createUploadSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const file = this.bucket.file(key);

    try {
      const [signedUrl] = await file.getSignedUrl({
        action: "write",
        expires: Date.now() + expiresIn * 1000,
        contentType: "application/octet-stream",
      });
      return signedUrl;
    } catch (error) {
      console.error("Error generating signed URL:", error);
      throw new Error("Failed to generate signed URL");
    }
  }
}

// Export a default instance
// Lazy-loaded storage instance to avoid instantiation before env vars are loaded
let _storageInstance: GoogleStorageService | null = null;

export const getStorage = (): GoogleStorageService => {
  if (!_storageInstance) {
    _storageInstance = new GoogleStorageService();
  }
  return _storageInstance;
};
