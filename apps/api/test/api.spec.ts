import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { requestOrigin } from "../src/origin";
import { formatExpiryRemaining, viewerHtml } from "../src/pages";

describe("hauntshot api", () => {
  it("exposes health without device header", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects /v1 without device id", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/v1/shots");
    expect(res.status).toBe(401);
  });

  it("redirects product downloads", async () => {
    const app = createApp();
    const mac = await app.request("http://localhost/download/mac", {
      redirect: "manual",
    });
    expect(mac.status).toBe(302);
    const loc = mac.headers.get("Location") ?? "";
    expect(loc).toMatch(/github\.com\/stormageddon\/HauntShot/);
  });

  it("formats remaining TTL as HHh MMm", () => {
    const now = Date.parse("2026-09-08T12:00:00.000Z");
    expect(
      formatExpiryRemaining("2026-09-09T11:05:00.000Z", now),
    ).toBe("23h 05m");
    expect(
      formatExpiryRemaining("2026-09-08T12:00:00.000Z", now),
    ).toBe("0h 00m");
  });

  it("renders a downloadable viewer without view-only chrome", () => {
    const html = viewerHtml({
      imageUrl: "/i/abc123",
      origin: "http://localhost",
      expiresAt: "2026-09-09T11:05:00.000Z",
      downloadUrl: "/i/abc123?download=1",
      filename: "hauntshot-abc123.png",
    });
    expect(html).toMatch(/href="\/i\/abc123\?download=1"/);
    expect(html).toMatch(/download="hauntshot-abc123\.png"/);
    expect(html).toContain("Download");
    expect(html).toMatch(/id="ttl">Expires in \d+h \d{2}m</);
    expect(html).not.toMatch(/view only/i);
    expect(html).not.toMatch(/purged after/i);
    const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).toContain("Download");
    expect(header).not.toContain("Expires in");
    expect(html).toContain("Report inappropriate image");
    expect(html).toMatch(
      /href="mailto:reports@hauntshot\.com\?subject=Inappropriate%20image%20abc123"/,
    );
    expect(html).not.toMatch(/mailto:[^"]*&body=/);
  });

  it("keeps local share URLs off hauntshot.com under wrangler custom domains", () => {
    expect(
      requestOrigin({
        req: {
          url: "http://hauntshot.com/v1/shots",
          header: (name) =>
            name === "MF-Original-Hostname" ? "hauntshot.com" : undefined,
        },
      }),
    ).toBe("http://127.0.0.1:8787");
    expect(
      requestOrigin({
        req: {
          url: "https://hauntshot.com/v1/shots",
          header: () => undefined,
        },
      }),
    ).toBe("https://hauntshot.com");
    expect(
      requestOrigin({
        req: {
          url: "http://hauntshot.com/v1/shots",
          header: () => undefined,
        },
        env: { PUBLIC_ORIGIN: "http://127.0.0.1:8787/" },
      }),
    ).toBe("http://127.0.0.1:8787");
  });
});
