import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Persistent analysis cache. Keyed by a versioned SHA-256 of the image bytes.
// Allows instant cache-hit returns for previously-analyzed images without
// re-running the two GPT model passes.
export const analysisCacheTable = pgTable("analysis_cache", {
  cacheKey: text("cache_key").primaryKey(),
  imageHash: text("image_hash").notNull(),
  analysisVersion: text("analysis_version").notNull(),
  analysisJson: jsonb("analysis_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastAccessedAt: timestamp("last_accessed_at"),
});

export type AnalysisCacheRow = typeof analysisCacheTable.$inferSelect;
export type InsertAnalysisCacheRow = typeof analysisCacheTable.$inferInsert;
