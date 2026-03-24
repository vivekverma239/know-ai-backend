import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
  db: PostgresJsDatabase<typeof schema> | undefined;
};

export const getDb = () => {
  if (globalForDb.db) return globalForDb.db;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize the database connection.");
  }

  const conn = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  const db = drizzle(conn, { schema });

  globalForDb.conn = conn;
  globalForDb.db = db;

  return db;
};
