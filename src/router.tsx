import { createRouter } from "@tanstack/react-router";
// Import the generated route tree
import { routeTree } from "./routeTree.gen";

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    // Start captures this when it attaches serialization, before the stream handler runs.
    ssr: import.meta.env.SSR ? { nonce: createNonce() } : undefined,

    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
