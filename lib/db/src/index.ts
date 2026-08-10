import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL?.trim();

// The product can run without a persistent cache. When DATABASE_URL is set,
// behavior is unchanged and the Postgres-backed cache is enabled.
export const pool = connectionString ? new Pool({ connectionString }) : null;
export const db = pool ? drizzle(pool, { schema }) : null;
export const isDatabaseConfigured = db !== null;

export * from "./schema";
