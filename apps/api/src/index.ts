import { createApp } from "./app";
import { purgeExpiredShots } from "./jobs/purge-expired";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: { DB: D1Database; BUCKET: R2Bucket },
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(purgeExpiredShots(env));
  },
};
