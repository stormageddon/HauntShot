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
import { landingHtml, privacyHtml, termsHtml } from "./pages";
import {
  billingCancelHtml,
  billingSuccessHtml,
  billingUpgradeHtml,
  handleStripeWebhook,
  startCheckout,
  startPortal,
} from "./billing";

export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
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

  app.get("/", (c) => c.html(landingHtml(new URL(c.req.url).origin)));
  app.get("/privacy", (c) => c.html(privacyHtml()));
  app.get("/terms", (c) => c.html(termsHtml()));
  // Installers still come from GitHub Actions until we host binaries ourselves.
  app.get("/download/mac", (c) =>
    c.redirect(
      "https://github.com/stormageddon/HauntShot/actions/workflows/macos-build.yml",
      302,
    ),
  );
  app.get("/download/windows", (c) =>
    c.redirect(
      "https://github.com/stormageddon/HauntShot/actions/workflows/windows-build.yml",
      302,
    ),
  );

  app.get("/billing/success", (c) => c.html(billingSuccessHtml()));
  app.get("/billing/cancel", (c) => c.html(billingCancelHtml()));
  app.get("/billing/upgrade", (c) =>
    c.html(billingUpgradeHtml(new URL(c.req.url).origin)),
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
    const origin = new URL(c.req.url).origin;
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

    const origin = new URL(c.req.url).origin;
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
      return c.html(
        `<!doctype html><html><head><meta charset="utf-8"><title>HauntShot</title></head>
         <body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;background:#0a0212;color:#f0e8fa">
           <h1>This screenshot is gone</h1>
           <p>It expired or the link is invalid. Temporary links are deleted automatically after 24 hours.</p>
         <p style="margin-top:1.5rem"><a href="/" style="color:#c9a8ff">HauntShot</a> · <a href="/privacy" style="color:#c9a8ff">Privacy</a></p>
         </body></html>`,
        404,
      );
    }

    const expiresIso = rowToSummary(shot, new URL(c.req.url).origin).expiresAt;
    const remainingMs = new Date(expiresIso).getTime() - Date.now();
    const hours = Math.max(0, Math.floor(remainingMs / 3_600_000));
    const mins = Math.max(0, Math.floor((remainingMs % 3_600_000) / 60_000));
    const imageUrl = `/i/${shot.id}`;
    const origin = new URL(c.req.url).origin;

    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HauntShot · Temporary screenshot</title>
  <meta property="og:title" content="Temporary screenshot" />
  <meta property="og:description" content="Expires in about ${hours}h ${mins}m · view only" />
  <meta property="og:image" content="${origin}${imageUrl}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    body { margin:0; font-family:system-ui,sans-serif; background:#0a0212; color:#f0e8fa; }
    header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; }
    img { display:block; max-width:100%; max-height:calc(100vh - 88px); margin:0 auto; }
    footer { padding:12px 16px; font-size:12px; color:#a898bf; display:flex; justify-content:space-between; }
  </style>
</head>
<body>
  <header>
    <strong>HauntShot</strong>
    <span>Expires in ${hours}h ${mins}m</span>
  </header>
  <main><img src="${imageUrl}" alt="Temporary screenshot" /></main>
  <footer>
    <span><a href="/privacy" style="color:#a898bf">Privacy</a> · view only · purged after 24h</span>
    <span>Report</span>
  </footer>
</body>
</html>`);
  });

  app.get("/i/:id", async (c) => {
    const shot = await getLiveShot(c.env.DB, c.req.param("id"));
    if (!shot) return c.notFound();
    const storage = new R2Storage(c.env.BUCKET);
    const obj = await storage.get(shot.object_key);
    if (!obj) return c.notFound();
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  });

  return app;
}
