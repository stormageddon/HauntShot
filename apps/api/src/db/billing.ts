import type { QuotaStatus } from "@hauntshot/shared";
import { FREE_DAILY_LIMIT } from "@hauntshot/shared";

export interface UserRow {
  id: string;
  email: string;
  created_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  tier: "free" | "paid";
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<UserRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .bind(id)
      .first<UserRow>()) ?? null
  );
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .bind(email.toLowerCase())
      .first<UserRow>()) ?? null
  );
}

export async function getUserByStripeCustomer(
  db: D1Database,
  customerId: string,
): Promise<UserRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM users WHERE stripe_customer_id = ?`)
      .bind(customerId)
      .first<UserRow>()) ?? null
  );
}

export async function ensureUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();
  const existing = await getUserByEmail(db, normalized);
  if (existing) return existing;

  const id = `usr_${newId()}`;
  await db
    .prepare(`INSERT INTO users (id, email) VALUES (?, ?)`)
    .bind(id, normalized)
    .run();
  const created = await getUserById(db, id);
  if (!created) throw new Error("Failed to create user");
  return created;
}

export async function linkDeviceToUser(
  db: D1Database,
  deviceId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE devices SET user_id = ? WHERE id = ?`)
    .bind(userId, deviceId)
    .run();
}

export async function setUserPaid(
  db: D1Database,
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET tier = 'paid',
           stripe_customer_id = ?,
           stripe_subscription_id = ?
       WHERE id = ?`,
    )
    .bind(stripeCustomerId, stripeSubscriptionId, userId)
    .run();
  // Every device on this account inherits paid.
  await db
    .prepare(`UPDATE devices SET tier = 'paid' WHERE user_id = ?`)
    .bind(userId)
    .run();
}

export async function setUserFree(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET tier = 'free',
           stripe_subscription_id = NULL
       WHERE id = ?`,
    )
    .bind(userId)
    .run();
  await db
    .prepare(`UPDATE devices SET tier = 'free' WHERE user_id = ?`)
    .bind(userId)
    .run();
}

/**
 * Paid if the device itself is paid, or its linked user is paid.
 * User tier wins when a device is linked — one subscription covers every machine.
 */
export async function resolveDeviceTier(
  db: D1Database,
  deviceId: string,
): Promise<"free" | "paid"> {
  const row = await db
    .prepare(
      `SELECT d.tier AS device_tier, u.tier AS user_tier
       FROM devices d
       LEFT JOIN users u ON u.id = d.user_id
       WHERE d.id = ?`,
    )
    .bind(deviceId)
    .first<{ device_tier: string; user_tier: string | null }>();
  if (!row) return "free";
  if (row.user_tier === "paid" || row.device_tier === "paid") return "paid";
  return "free";
}

export async function quotaForResolvedTier(
  tier: "free" | "paid",
  usedToday: number,
): Promise<QuotaStatus> {
  return {
    tier,
    usedToday,
    dailyLimit: tier === "paid" ? null : FREE_DAILY_LIMIT,
  };
}
