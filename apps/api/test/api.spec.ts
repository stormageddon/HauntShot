import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

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
});
