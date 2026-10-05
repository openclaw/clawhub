import { createRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    // Start captures this when preparing hydration, before the render callback.
    ssr: { nonce: getGlobalStartContext()?.nonce },

    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
