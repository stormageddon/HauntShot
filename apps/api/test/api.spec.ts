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
});
