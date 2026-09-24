import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = resolve(repoRoot, "db/migrations/001_initial.sql");
const sql = await readFile(migrationPath, "utf8");
const pool = new pg.Pool({ connectionString, max: 1, application_name: "poke-fr-migration" });
try {
  await pool.query(sql);
  console.info("Applied db/migrations/001_initial.sql.");
} finally {
  await pool.end();
}
