import { logger } from "@/utils/logger";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl as getSignedUrlS3 } from "@aws-sdk/s3-request-presigner";

if (
  !process.env.SUPABASE_STORAGE_REGION ||
  !process.env.SUPABASE_STORAGE_URL ||
  !process.env.SUPABASE_STORAGE_ACCESS_KEY_ID ||
  !process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY
) {
  throw new Error(
    "SUPABASE_STORAGE_REGION, SUPABASE_STORAGE_URL, SUPABASE_STORAGE_ACCESS_KEY_ID, SUPABASE_STORAGE_SECRET_ACCESS_KEY are not set",
  );
}
export const supabaseClient = new S3Client({
  forcePathStyle: true,
  region: process.env.SUPABASE_STORAGE_REGION,
  endpoint: process.env.SUPABASE_STORAGE_URL,
  credentials: {
    accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
  },
});

export class StorageService {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    this.bucket = process.env.BUCKET_NAME ?? "";
    if (!this.bucket) {
      throw new Error("BUCKET_NAME is not set");
    }
    this.client = supabaseClient;
  }

  /**
   * Upload a file to R2
   */
  async uploadFile(params: {
    data: Buffer | string;
    contentType?: string;
    path: string;
  }) {
    const { data, contentType, path } = params;
    const key = path;

    const buffer = typeof data === "string" ? Buffer.from(data, "base64") : data;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    try {
      await this.client.send(command);
      return key;
    } catch (error) {
      logger.error("Error uploading to R2", {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      throw new Error("Failed to upload file");
    }
  }

  /**
   * Download a file from R2
   */
  async downloadFile(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      const response = await this.client.send(command);
      const data = await response.Body?.transformToByteArray();
      if (!data) throw new Error("No data received");
      return Buffer.from(data);
    } catch (error) {
      logger.error("Error downloading from R2", {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      throw new Error("Failed to download file");
    }
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      await this.client.send(command);
    } catch (error) {
      logger.error("Error deleting from R2", {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      throw new Error("Failed to delete file");
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(prefix?: string): Promise<_Object[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    try {
      const response = await this.client.send(command);
      return response.Contents ?? [];
    } catch (error) {
      logger.error("Error listing files from R2", {
        error: error instanceof Error ? error.message : String(error),
        prefix,
      });
      throw new Error("Failed to list files");
    }
  }

  /**
   * Generate a signed URL for temporary access to a file
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      // @ts-expect-error - S3Client generics mismatch with presigner Client due to version skew
      const signedUrl = await getSignedUrlS3(this.client, command, {
        expiresIn,
      });
      return signedUrl;
    } catch (error) {
      const err = error as Error;
      logger.error("Error generating signed URL", {
        error: err.message,
        key,
      });
      throw new Error("Failed to generate signed URL");
    }
  }

  async getSignedUploadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      // @ts-expect-error - S3Client generics mismatch with presigner Client due to version skew
      const signedUrl = await getSignedUrlS3(this.client, command, {
        expiresIn,
      });
      return signedUrl;
    } catch (error) {
      const err = error as Error;
      logger.error("Error generating signed upload URL", {
        error: err.message,
        key,
      });
      throw new Error("Failed to generate signed URL");
    }
  }

  async getFile(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      const response = await this.client.send(command);
      const data = await response.Body?.transformToByteArray();
      if (!data) throw new Error("No data received");
      return Buffer.from(data);
    } catch (error) {
      logger.error("Error getting file from R2", {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      throw new Error("Failed to get file");
    }
  }

  /**
   * Check if a file exists in Storage
   */
  async exists(key: string): Promise<boolean> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    try {
      await this.client.send(command);
      return true;
    } catch (error) {
      return false;
    }
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: sourcePath,
      Key: targetPath,
    });

    try {
      await this.client.send(command);
    } catch (error) {
      logger.error("Error copying file in storage", {
        error: error instanceof Error ? error.message : String(error),
        sourcePath,
        targetPath,
      });
      throw new Error("Failed to copy file");
    }
  }

  async createUploadSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      // @ts-expect-error - S3Client generics mismatch with presigner Client due to version skew
      const signedUrl = await getSignedUrlS3(this.client, command, {
        expiresIn,
      });
      return signedUrl;
    } catch (error) {
      logger.error("Error generating signed URL for upload", {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      throw new Error("Failed to generate signed URL");
    }
  }
}

// Export a default instance
export const storage = new StorageService();
