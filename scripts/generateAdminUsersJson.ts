import bcrypt from "bcryptjs";
import { generateSecret, generateURI } from "otplib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";

type AdminUserRecord = {
  userId: string;
  passwordHash: string;
  totpSecret: string;
};

type AdminSecretsFile = {
  issuer: string;
  generatedAt: string;
  users: AdminUserRecord[];
};

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2 !== 0) {
  console.error(
    "Usage: pnpm admin:generate-users-json <userId1> <password1> [<userId2> <password2> ...]",
  );
  process.exit(1);
}

const saltRoundsRaw = process.env.ADMIN_PASSWORD_SALT_ROUNDS ?? "12";
const saltRounds = Number.parseInt(saltRoundsRaw, 10);
if (!Number.isFinite(saltRounds) || saltRounds < 8) {
  console.error("ADMIN_PASSWORD_SALT_ROUNDS must be a number >= 8");
  process.exit(1);
}

const totpIssuer = process.env.ADMIN_TOTP_ISSUER ?? "Knowsis Admin";
const qrOutputDir = process.env.ADMIN_QR_OUTPUT_DIR ?? "data/admin-totp-qr";
const secretsFile = process.env.ADMIN_SECRETS_FILE ?? "data/admin-secrets.json";

const sanitizeFileSegment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

const loadExistingUsers = async (filePath: string): Promise<AdminUserRecord[]> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { users?: AdminUserRecord[] };
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch {
    return [];
  }
};

const run = async () => {
  const absoluteQrOutputDir = path.resolve(process.cwd(), qrOutputDir);
  const absoluteSecretsFilePath = path.resolve(process.cwd(), secretsFile);
  await mkdir(absoluteQrOutputDir, { recursive: true });
  await mkdir(path.dirname(absoluteSecretsFilePath), { recursive: true });

  const existingUsers = await loadExistingUsers(absoluteSecretsFilePath);
  const users: AdminUserRecord[] = [...existingUsers];
  const enrollmentData: Array<{
    userId: string;
    totpSecret: string;
    otpAuthUri: string;
    qrPngPath: string;
  }> = [];

  for (let i = 0; i < args.length; i += 2) {
    const userId = args[i]?.trim();
    const password = args[i + 1];

    if (!userId || !password) {
      throw new Error(`Invalid user credentials at pair index ${i / 2}`);
    }

    if (users.some((user) => user.userId === userId)) {
      throw new Error(`User "${userId}" already exists. Remove them first or choose a different userId.`);
    }

    const passwordHash = await bcrypt.hash(password, saltRounds);
    const totpSecret = generateSecret();
    const otpAuthUri = generateURI({
      issuer: totpIssuer,
      label: userId,
      secret: totpSecret,
    });
    const qrPngPath = path.join(absoluteQrOutputDir, `${sanitizeFileSegment(userId)}.png`);
    await QRCode.toFile(qrPngPath, otpAuthUri, {
      type: "png",
      errorCorrectionLevel: "high",
      margin: 2,
      width: 300,
    });

    users.push({
      userId,
      passwordHash,
      totpSecret,
    });

    enrollmentData.push({
      userId,
      totpSecret,
      otpAuthUri,
      qrPngPath,
    });
  }

  const adminSecrets: AdminSecretsFile = {
    issuer: totpIssuer,
    generatedAt: new Date().toISOString(),
    users,
  };
  await writeFile(`${absoluteSecretsFilePath}`, `${JSON.stringify(adminSecrets, null, 2)}\n`, {
    mode: 0o600,
  });

  console.log(`Admin secrets file written to: ${absoluteSecretsFilePath}`);
  console.log(`  Existing users kept: ${existingUsers.length}`);
  console.log(`  New users added: ${enrollmentData.length}`);
  console.log(`  Total users: ${users.length}`);
  console.log("\nSet this in your .env:");
  console.log(`ADMIN_SECRETS_FILE=${absoluteSecretsFilePath}`);
  console.log(`ADMIN_JWT_SECRET=${process.env.ADMIN_JWT_SECRET ?? "<set_a_long_random_secret>"}`);
  console.log(`ADMIN_USERS_JSON=${JSON.stringify(adminSecrets.users)}`);
  console.log("\nTOTP enrollment data for NEW users (save securely):\n");
  console.log(JSON.stringify(enrollmentData, null, 2));
  console.log(`\nQR images written to: ${absoluteQrOutputDir}`);
};

run().catch((error) => {
  console.error(
    `Failed to generate admin users JSON: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
