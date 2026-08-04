import { R2Storage } from "../adapters/r2-storage";
import { deleteShotRow, listExpiredShots } from "../db/shots";

const BATCH = 100;
/** Cap work per cron tick so we stay well under Worker CPU limits. */
const MAX_BATCHES = 20;

export type PurgeEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

/**
 * Deletes expired shots from R2 then D1. Safe to re-run: a row whose object
 * is already gone still gets removed from D1 on the next pass.
 */
export async function purgeExpiredShots(env: PurgeEnv): Promise<{
  removed: number;
  r2Errors: number;
}> {
  const storage = new R2Storage(env.BUCKET);
  let removed = 0;
  let r2Errors = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const batch = await listExpiredShots(env.DB, BATCH);
    if (batch.length === 0) break;

    for (const shot of batch) {
      try {
        await storage.delete(shot.object_key);
      } catch (e) {
        r2Errors += 1;
        console.error(
          JSON.stringify({
            msg: "purge_r2_failed",
            id: shot.id,
            key: shot.object_key,
            error: String(e),
          }),
        );
        // Still drop the row — an orphaned object is preferable to a forever
        // ghost link that claims the shot exists.
      }
      await deleteShotRow(env.DB, shot.id);
      removed += 1;
    }

    if (batch.length < BATCH) break;
  }

  console.log(JSON.stringify({ msg: "purge_complete", removed, r2Errors }));
  return { removed, r2Errors };
}
