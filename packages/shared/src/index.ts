/** Shared API contracts — desktop and Workers both import these shapes. */

export const FREE_LIVE_LIMIT = 10;
export const TTL_MS = 24 * 60 * 60 * 1000;
/** Control (not Command) on Mac — avoids macOS Screenshot ⌘⇧5. Same chord on Windows. */
export const DEFAULT_HOTKEY = "Control+Shift+5";

export type ShotId = string;
export type DeviceId = string;

export interface ShotSummary {
  id: ShotId;
  createdAt: string; // ISO
  expiresAt: string; // ISO
  /** Public viewer path on our domain, e.g. /s/:id */
  viewerPath: string;
  /** Absolute viewer URL when API base is known */
  viewerUrl?: string;
  contentType: string;
  byteSize: number;
}

export interface QuotaStatus {
  tier: "free" | "paid";
  liveCount: number;
  liveLimit: number | null; // null = unlimited
}

export interface CreateShotResponse {
  shot: ShotSummary;
  quota: QuotaStatus;
}

export interface ListShotsResponse {
  shots: ShotSummary[];
  quota: QuotaStatus;
}

export interface ApiErrorBody {
  error: string;
  code?:
    | "quota_exceeded"
    | "not_found"
    | "expired"
    | "unauthorized"
    | "bad_request"
    | "internal";
}
