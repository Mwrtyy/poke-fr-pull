import pg, { type QueryResultRow } from "pg";
import { config, requireEnv } from "./config.js";

const { Pool } = pg;
export const pool = new Pool({
  connectionString: requireEnv(config.databaseUrl, "DATABASE_URL"),
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  application_name: "poke-fr-pull",
});

export function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}
