import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type _Object,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getSignedUrlS3 } from "@aws-sdk/s3-request-presigner";
import { S3Client } from "@aws-sdk/client-s3";

export const supabaseClient = new S3Client({
  forcePathStyle: true,
  region: process.env.SUPABASE_STORAGE_REGION!,
  endpoint: process.env.SUPABASE_STORAGE_URL!,
  credentials: {
    accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY!,
  },
});

export class StorageService {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    this.bucket = process.env.BUCKET_NAME!;
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

    const buffer =
      typeof data === "string" ? Buffer.from(data, "base64") : data;

    console.log("ContentType", contentType);
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
      console.error("Error uploading to R2:", error);
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
      console.error("Error downloading from R2:", error);
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
      console.error("Error deleting from R2:", error);
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
      console.error("Error listing files from R2:", error);
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
      console.error("Error generating signed URL:", err.message);
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
      console.error("Error generating signed URL:", err.message);
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
      console.error("Error getting file from R2:", error);
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
      console.error("Error copying file in Supabase:", error);
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
      console.error("Error generating signed URL:", error);
      throw new Error("Failed to generate signed URL");
    }
  }
}

// Export a default instance
export const storage = new StorageService();
