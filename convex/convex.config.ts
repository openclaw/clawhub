import migrations from "@convex-dev/migrations/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(migrations);
// v2: the original instance grew unbounded (~40M rows); a fresh instance lets the old one be dropped.
app.use(rateLimiter, { name: "rateLimiterV2" });
app.use(workpool, { name: "searchReports" });

export default app;
