import { Hono } from "hono";
import { cors } from "hono/cors";
import type { QuotaStatus, CreateShotResponse, ListShotsResponse } from "@hauntshot/shared";
import { FREE_DAILY_LIMIT, TTL_MS } from "@hauntshot/shared";
import { R2Storage } from "./adapters/r2-storage";
import {
  countCapturesToday,
  ensureDevice,
  getDeviceTier,
  getLiveShot,
  insertShot,
  listLiveShots,
  quotaForDevice,
  rowToSummary,
} from "./db/shots";
import {
  downloadFilename,
  goneHtml,
  landingHtml,
  privacyHtml,
  termsHtml,
  viewerHtml,
} from "./pages";
import {
  DOWNLOAD_FALLBACK,
  fetchUpdaterManifest,
  macDownloadUrl,
  windowsDownloadUrl,
} from "./downloads";
import {
  billingCancelHtml,
  billingSuccessHtml,
  billingUpgradeHtml,
  handleStripeWebhook,
  startCheckout,
  startPortal,
} from "./billing";
import { requestOrigin } from "./origin";

export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  PUBLIC_ORIGIN?: string;
  ENVIRONMENT?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  STRIPE_ACCOUNT_ID?: string;
};

type Variables = {
  deviceId: string;
};

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function requireDeviceId(header: string | undefined): string | null {
  if (!header) return null;
  const id = header.trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) return null;
  return id;
}

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "X-HauntShot-Device-Id"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.get("/health", (c) => {
    const environment =
      c.env && "ENVIRONMENT" in c.env ? (c.env.ENVIRONMENT ?? "dev") : "dev";
    return c.json({ ok: true, service: "hauntshot-api", env: environment });
  });

  app.get("/", (c) => c.html(landingHtml(requestOrigin(c))));
  app.get("/privacy", (c) => c.html(privacyHtml()));
  app.get("/terms", (c) => c.html(termsHtml()));
  app.get("/download/mac", async (c) => {
    const url = (await macDownloadUrl()) ?? DOWNLOAD_FALLBACK.mac;
    return c.redirect(url, 302);
  });
  app.get("/download/windows", async (c) => {
    const url = (await windowsDownloadUrl()) ?? DOWNLOAD_FALLBACK.windows;
    return c.redirect(url, 302);
  });

  // Tauri updater static JSON (uploaded to each GitHub Release by CI).
  app.get("/updates/latest.json", async (c) => {
    const upstream = await fetchUpdaterManifest();
    if (!upstream.ok) {
      return c.json({ error: "No updater manifest published yet" }, 404);
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  });

  app.get("/billing/success", (c) => c.html(billingSuccessHtml()));
  app.get("/billing/cancel", (c) => c.html(billingCancelHtml()));
  app.get("/billing/upgrade", (c) =>
    c.html(billingUpgradeHtml(requestOrigin(c))),
  );
  app.post("/webhooks/stripe", (c) => handleStripeWebhook(c));

  const v1 = new Hono<{ Bindings: Env; Variables: Variables }>();

  v1.use("*", async (c, next) => {
    const deviceId = requireDeviceId(c.req.header("X-HauntShot-Device-Id"));
    if (!deviceId) {
      return c.json(
        { error: "Missing or invalid X-HauntShot-Device-Id", code: "unauthorized" },
        401,
      );
    }
    c.set("deviceId", deviceId);
    await ensureDevice(c.env.DB, deviceId);
    await next();
  });

  v1.get("/quota", async (c) => {
    const quota = await quotaForDevice(c.env.DB, c.get("deviceId"));
    return c.json(quota satisfies QuotaStatus);
  });

  v1.post("/billing/checkout", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      plan?: string;
    };
    const plan = body.plan === "yearly" ? "yearly" : "monthly";
    return startCheckout(c, c.get("deviceId"), plan);
  });

  v1.post("/billing/portal", async (c) => {
    return startPortal(c, c.get("deviceId"));
  });

  v1.get("/shots", async (c) => {
    const deviceId = c.get("deviceId");
    const rows = await listLiveShots(c.env.DB, deviceId);
    const origin = requestOrigin(c);
    const body: ListShotsResponse = {
      shots: rows.map((r) => rowToSummary(r, origin)),
      quota: await quotaForDevice(c.env.DB, deviceId),
    };
    return c.json(body);
  });

  v1.post("/shots", async (c) => {
    const deviceId = c.get("deviceId");
    const tier = await getDeviceTier(c.env.DB, deviceId);
    if (tier === "free") {
      const used = await countCapturesToday(c.env.DB, deviceId);
      if (used >= FREE_DAILY_LIMIT) {
        return c.json(
          {
            error: `Free daily limit reached (${FREE_DAILY_LIMIT}). Resets at midnight UTC, or upgrade for unlimited.`,
            code: "quota_exceeded",
          },
          402,
        );
      }
    }

    const contentType = c.req.header("Content-Type") ?? "image/png";
    if (!contentType.startsWith("image/")) {
      return c.json(
        { error: "Content-Type must be an image/*", code: "bad_request" },
        400,
      );
    }

    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 15 * 1024 * 1024) {
      return c.json(
        { error: "Image must be between 1 byte and 15MB", code: "bad_request" },
        400,
      );
    }

    const id = newId();
    const objectKey = `shots/${id}`;
    const storage = new R2Storage(c.env.BUCKET);
    const stored = await storage.put(objectKey, bytes, contentType);

    const now = new Date();
    const expires = new Date(now.getTime() + TTL_MS);
    const createdAt = now.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
    const expiresAt = expires
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");

    await insertShot(c.env.DB, {
      id,
      device_id: deviceId,
      object_key: stored.key,
      content_type: stored.contentType,
      byte_size: stored.byteSize,
      created_at: createdAt,
      expires_at: expiresAt,
    });

    const origin = requestOrigin(c);
    const body: CreateShotResponse = {
      shot: rowToSummary(
        {
          id,
          device_id: deviceId,
          user_id: null,
          object_key: stored.key,
          content_type: stored.contentType,
          byte_size: stored.byteSize,
          created_at: createdAt,
          expires_at: expiresAt,
          deleted_at: null,
        },
        origin,
      ),
      quota: await quotaForDevice(c.env.DB, deviceId),
    };
    return c.json(body, 201);
  });

  app.route("/v1", v1);

  // Public viewer — our domain paths, not raw R2 URLs
  app.get("/s/:id", async (c) => {
    const shot = await getLiveShot(c.env.DB, c.req.param("id"));
    if (!shot) {
      return c.html(goneHtml(), 404);
    }

    const origin = requestOrigin(c);
    const imageUrl = `/i/${shot.id}`;
    const filename = downloadFilename(shot.id, shot.content_type);
    return c.html(
      viewerHtml({
        imageUrl,
        origin,
        expiresAt: rowToSummary(shot, origin).expiresAt,
        downloadUrl: `${imageUrl}?download=1`,
        filename,
      }),
    );
  });

  app.get("/i/:id", async (c) => {
    const shot = await getLiveShot(c.env.DB, c.req.param("id"));
    if (!shot) return c.notFound();
    const storage = new R2Storage(c.env.BUCKET);
    const obj = await storage.get(shot.object_key);
    if (!obj) return c.notFound();
    const filename = downloadFilename(shot.id, shot.content_type);
    const headers: Record<string, string> = {
      "Content-Type": obj.contentType,
      "Cache-Control": "public, max-age=300",
    };
    if (c.req.query("download") !== undefined) {
      headers["Content-Disposition"] =
        `attachment; filename="${filename}"`;
    }
    return new Response(obj.body, { headers });
  });

  return app;
}
