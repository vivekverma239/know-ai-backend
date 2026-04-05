import { Storage } from "@google-cloud/storage";
import crypto from "node:crypto";
import fs from "node:fs";
import { env } from "./env.js";

let _client: Storage | null = null;

function resolveCredentials(): Record<string, unknown> | null {
  if (env.gcsCredentialsBase64) {
    return JSON.parse(Buffer.from(env.gcsCredentialsBase64, "base64").toString("utf-8"));
  }

  if (env.gcsCredentialsRaw) {
    const parsed = JSON.parse(env.gcsCredentialsRaw);
    if (parsed.private_key && typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  }

  return null;
}

function getClient(): Storage {
  if (_client) return _client;

  const creds = resolveCredentials();
  if (creds) {
    _client = new Storage({ credentials: creds as any, projectId: creds.project_id as string });
  } else {
    _client = new Storage();
  }

  return _client;
}

export async function uploadAndGetSignedUrl(
  localPath: string,
  bucketName: string,
  expiresInSeconds = 3600
): Promise<{ signedUrl: string; blobPath: string }> {
  const client = getClient();
  const bucket = client.bucket(bucketName);

  const fileBuffer = fs.readFileSync(localPath);
  const hash = crypto.createHash("md5").update(fileBuffer).digest("hex");
  const blobPath = `eval-tool/tmp_${hash}.pdf`;

  console.log(`Uploading to GCS: gs://${bucketName}/${blobPath}`);
  await bucket.upload(localPath, {
    destination: blobPath,
    contentType: "application/pdf",
    metadata: { cacheControl: "max-age=3600" },
  });

  const [signedUrl] = await bucket.file(blobPath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInSeconds * 1000,
  });

  console.log("Signed URL generated.");
  return { signedUrl, blobPath };
}

export async function deleteTempBlob(
  blobPath: string,
  bucketName: string,
): Promise<void> {
  const client = getClient();
  try {
    await client.bucket(bucketName).file(blobPath).delete();
    console.log(`Cleaned up temp blob: ${blobPath}`);
  } catch {
    console.warn(`Failed to clean up temp blob: ${blobPath}`);
  }
}
