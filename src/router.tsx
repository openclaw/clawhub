import { createRouter } from "@tanstack/react-router";
import { NotFoundPage } from "./components/NotFoundPage";
// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},

    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFoundPage,
  });

  return router;
};
