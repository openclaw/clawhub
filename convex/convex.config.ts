import migrations from "@convex-dev/migrations/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    CLAWHUB_TRAFFIC_EXPLANATION_TOKEN_SECRET: v.optional(v.string()),
  },
});
app.use(migrations);
app.use(rateLimiter);

export default app;
