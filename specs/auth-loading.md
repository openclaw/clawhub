# Auth Loading Semantics

ClawHub treats session resolution and user-profile resolution as one protected-page gate.

`useAuthStatus()` is the canonical client hook for auth-aware UI. It owns the `users.me`
query and keeps `isLoading` true until Convex auth has resolved and, for authenticated
sessions, the current user document has resolved.

Protected routes must not render signed-out prompts, permission-denied states, empty states,
or user-scoped content while `useAuthStatus().isLoading` is true. They should render a
route-shaped skeleton until the gate resolves.

User-scoped queries must be skipped until a current user exists:

```ts
const { isAuthenticated, isLoading, me } = useAuthStatus();
const result = useQuery(api.some.userScopedQuery, me ? { userId: me._id } : "skip");
```

After the loading gate resolves:

- `!isAuthenticated || !me` means the viewer should see the signed-out state.
- `me` means user-scoped queries can start.
- Public pages may render public content without waiting for auth, but personalized controls
  and ownership/publisher queries must stay skipped until `me` exists.

This prevents flash sequences such as login prompt -> loading state -> real content, and
empty state -> loaded user content.
