import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AdminLoginRequestSchema,
  AdminLoginResponseSchema,
  AdminSessionSchema,
  AdminVerifyTotpRequestSchema,
  AdminVerifyTotpResponseSchema,
} from "@/schemas/admin.schema";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { verify } from "otplib";

// Simple in-memory rate limiter for auth endpoints
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const checkRateLimit = (key: string): boolean => {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
};

type AdminUserConfig = {
  userId: string;
  passwordHash: string;
  totpSecret: string;
};

const parseMinutes = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveAdminSecretsFile = () => {
  return process.env.ADMIN_SECRETS_FILE ?? "data/admin-secrets.json";
};

const loadAdminUsers = async () => {
  const filePath = path.resolve(process.cwd(), resolveAdminSecretsFile());
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("users" in parsed) ||
    !Array.isArray(parsed.users) ||
    parsed.users.length === 0
  ) {
    throw new Error("admin-secrets file must be an object with a non-empty users array.");
  }

  const users = parsed.users.map((entry) => {
    const userId = typeof entry?.userId === "string" ? entry.userId.trim() : "";
    const passwordHash = typeof entry?.passwordHash === "string" ? entry.passwordHash : "";
    const totpSecret = typeof entry?.totpSecret === "string" ? entry.totpSecret : "";

    if (!userId || !passwordHash || !totpSecret) {
      throw new Error("Each admin user must include userId, passwordHash and totpSecret.");
    }
    return {
      userId,
      passwordHash,
      totpSecret,
    } satisfies AdminUserConfig;
  });

  const uniqueUserIds = new Set(users.map((user) => user.userId));
  if (uniqueUserIds.size !== users.length) {
    throw new Error("admin-secrets file contains duplicate userId values.");
  }

  return users;
};

const getAdminConfig = async () => {
  const jwtSecret = process.env.ADMIN_JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("ADMIN_JWT_SECRET is required.");
  }

  try {
    const adminUsers = await loadAdminUsers();
    return {
      adminUsers,
      jwtKey: new TextEncoder().encode(jwtSecret),
      challengeTtlMinutes: parseMinutes(process.env.ADMIN_CHALLENGE_TTL_MINUTES, 5),
      accessTtlMinutes: parseMinutes(process.env.ADMIN_ACCESS_TTL_MINUTES, 480),
    };
  } catch (error) {
    throw new Error(
      `Failed to load admin secrets from ${resolveAdminSecretsFile()}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const adminAuthRoutes = async (fastify: FastifyInstance) => {
  fastify.post<{
    Body: { userId: string; password: string };
  }>("/login", {
    schema: {
      description: "Admin login with userId and password",
      tags: ["Admin"],
      body: AdminLoginRequestSchema,
      response: {
        200: AdminLoginResponseSchema,
        401: Type.Object({ error: Type.String() }),
        429: Type.Object({ error: Type.String() }),
        500: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      try {
        const config = await getAdminConfig();
        const clientIp = request.ip;
        if (!checkRateLimit(`login:${clientIp}`)) {
          return reply.code(429).send({ error: "Too many login attempts. Try again later." });
        }
        const userId = request.body.userId.trim();
        const password = request.body.password;

        const adminUser = config.adminUsers.find((user) => user.userId === userId);
        if (!adminUser) {
          return reply.code(401).send({
            error: "Invalid credentials",
          });
        }

        const isPasswordValid = await bcrypt.compare(password, adminUser.passwordHash);

        if (!isPasswordValid) {
          return reply.code(401).send({
            error: "Invalid credentials",
          });
        }

        const challengeToken = await new SignJWT({
          tokenType: "admin_challenge",
          userId: adminUser.userId,
        })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime(`${config.challengeTtlMinutes}m`)
          .sign(config.jwtKey);

        return reply.send({
          challengeToken,
          expiresInSeconds: config.challengeTtlMinutes * 60,
        });
      } catch (error) {
        logger.error("Admin login failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.code(500).send({
          error: "Admin auth is not configured correctly",
        });
      }
    },
  });

  fastify.post<{
    Body: { challengeToken: string; totpCode: string };
  }>("/verify-totp", {
    schema: {
      description: "Verify TOTP and issue admin access token",
      tags: ["Admin"],
      body: AdminVerifyTotpRequestSchema,
      response: {
        200: AdminVerifyTotpResponseSchema,
        401: Type.Object({ error: Type.String() }),
        429: Type.Object({ error: Type.String() }),
        500: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      try {
        const config = await getAdminConfig();
        const clientIp = request.ip;
        if (!checkRateLimit(`totp:${clientIp}`)) {
          return reply.code(429).send({ error: "Too many verification attempts. Try again later." });
        }
        const { challengeToken, totpCode } = request.body;

        let challengePayload: { userId: string } | null = null;
        try {
          const verified = await jwtVerify(challengeToken, config.jwtKey, {
            algorithms: ["HS256"],
          });
          const tokenType = verified.payload.tokenType;
          const userId = verified.payload.userId;
          if (tokenType !== "admin_challenge" || typeof userId !== "string") {
            return reply.code(401).send({
              error: "Invalid challenge token",
            });
          }
          challengePayload = { userId };
        } catch {
          return reply.code(401).send({
            error: "Invalid or expired challenge token",
          });
        }

        const adminUser = config.adminUsers.find((user) => user.userId === challengePayload.userId);
        if (!adminUser) {
          return reply.code(401).send({
            error: "Invalid challenge token",
          });
        }

        const sanitizedTotpCode = totpCode.replace(/\s+/g, "");
        const verifyResult = await verify({
          token: sanitizedTotpCode,
          secret: adminUser.totpSecret,
        });
        const isTotpValid = verifyResult.valid === true;

        if (!isTotpValid) {
          return reply.code(401).send({
            error: "Invalid TOTP code",
          });
        }

        const accessToken = await new SignJWT({
          tokenType: "admin_access",
          userId: adminUser.userId,
        })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime(`${config.accessTtlMinutes}m`)
          .sign(config.jwtKey);

        const expiresAt = new Date(Date.now() + config.accessTtlMinutes * 60 * 1000).toISOString();

        return reply.send({
          accessToken,
          expiresAt,
          admin: {
            userId: adminUser.userId,
          },
        });
      } catch (error) {
        logger.error("Admin TOTP verification failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.code(500).send({
          error: "Admin auth is not configured correctly",
        });
      }
    },
  });

  fastify.get("/me", {
    preHandler: fastify.authenticateAdmin,
    schema: {
      description: "Get current admin session",
      tags: ["Admin"],
      response: {
        200: AdminSessionSchema,
        401: Type.Object({ error: Type.String() }),
      },
    },
    handler: async (request, reply) => {
      if (!request.admin) {
        return reply.code(401).send({
          error: "Unauthorized",
        });
      }
      return reply.send({
        admin: {
          userId: request.admin.userId,
        },
        expiresAt: request.admin.expiresAt,
      });
    },
  });
};

export default adminAuthRoutes;
