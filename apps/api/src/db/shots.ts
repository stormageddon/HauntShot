import type { QuotaStatus, ShotSummary } from "@hauntshot/shared";
import { FREE_DAILY_LIMIT } from "@hauntshot/shared";

export interface ShotRow {
  id: string;
  device_id: string;
  user_id: string | null;
  object_key: string;
  content_type: string;
  byte_size: number;
  created_at: string;
  expires_at: string;
  deleted_at: string | null;
}

export function rowToSummary(row: ShotRow, origin: string): ShotSummary {
  const viewerPath = `/s/${row.id}`;
  return {
    id: row.id,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    viewerPath,
    viewerUrl: `${origin}${viewerPath}`,
    contentType: row.content_type,
    byteSize: row.byte_size,
  };
}

function toIso(sqliteDatetime: string): string {
  // D1/SQLite datetime('now') is UTC without Z; normalize for clients.
  if (sqliteDatetime.endsWith("Z") || sqliteDatetime.includes("+")) {
    return new Date(sqliteDatetime).toISOString();
  }
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").toISOString();
}

export async function ensureDevice(db: D1Database, deviceId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO devices (id) VALUES (?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(deviceId)
    .run();
}

/** Live (unexpired) shots — still used for the panel list, not for free quota. */
export async function countLiveShots(
  db: D1Database,
  deviceId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM shots
       WHERE device_id = ?
         AND deleted_at IS NULL
         AND expires_at > datetime('now')`,
    )
    .bind(deviceId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/** Captures started today in UTC — the free-tier meter. */
export async function countCapturesToday(
  db: D1Database,
  deviceId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM shots
       WHERE device_id = ?
         AND created_at >= datetime('now', 'start of day')`,
    )
    .bind(deviceId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function getDeviceTier(
  db: D1Database,
  deviceId: string,
): Promise<"free" | "paid"> {
  const row = await db
    .prepare(`SELECT tier FROM devices WHERE id = ?`)
    .bind(deviceId)
    .first<{ tier: string }>();
  return row?.tier === "paid" ? "paid" : "free";
}

export async function quotaForDevice(
  db: D1Database,
  deviceId: string,
): Promise<QuotaStatus> {
  const tier = await getDeviceTier(db, deviceId);
  const usedToday = await countCapturesToday(db, deviceId);
  return {
    tier,
    usedToday,
    dailyLimit: tier === "paid" ? null : FREE_DAILY_LIMIT,
  };
}

export async function listLiveShots(
  db: D1Database,
  deviceId: string,
): Promise<ShotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM shots
       WHERE device_id = ?
         AND deleted_at IS NULL
         AND expires_at > datetime('now')
       ORDER BY created_at DESC`,
    )
    .bind(deviceId)
    .all<ShotRow>();
  return results ?? [];
}

export async function insertShot(
  db: D1Database,
  shot: Omit<ShotRow, "deleted_at" | "user_id"> & { user_id?: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO shots
        (id, device_id, user_id, object_key, content_type, byte_size, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      shot.id,
      shot.device_id,
      shot.user_id ?? null,
      shot.object_key,
      shot.content_type,
      shot.byte_size,
      shot.created_at,
      shot.expires_at,
    )
    .run();
}

export async function getLiveShot(
  db: D1Database,
  id: string,
): Promise<ShotRow | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM shots
         WHERE id = ?
           AND deleted_at IS NULL
           AND expires_at > datetime('now')`,
      )
      .bind(id)
      .first<ShotRow>()) ?? null
  );
}

export async function listExpiredShots(
  db: D1Database,
  limit: number,
): Promise<ShotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM shots
       WHERE deleted_at IS NULL
         AND expires_at <= datetime('now')
       ORDER BY expires_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<ShotRow>();
  return results ?? [];
}

export async function deleteShotRow(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM shots WHERE id = ?`).bind(id).run();
}
