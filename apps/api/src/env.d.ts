/** Fallback Env when worker-configuration.d.ts is missing (run `npm run cf-typegen -w api`). */
interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ENVIRONMENT?: string;
}
