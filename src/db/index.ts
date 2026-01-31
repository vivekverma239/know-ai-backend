import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

export const getDb = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize the database connection.");
  }
  const conn = globalForDb.conn ?? postgres(databaseUrl);
  if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

  return drizzle(conn, { schema });
};
