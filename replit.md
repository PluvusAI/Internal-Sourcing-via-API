# Running on Replit

This repository is a React/TypeScript UI and Express server in one process. Keep
the existing structure; sourcing and durable storage belong to the separate
Pluvus sourcing backend, not this app.

## Development

Use the **Start application** workflow (`npm run dev`). Express listens on
`0.0.0.0:5000` and mounts Vite middleware for the UI. Browser API requests use
the same origin. Vite allows the Replit preview proxy hostname.

The default modes are live sourcing and Clerk authentication. Until configured,
the server intentionally stays available, `/health` responds, and the UI names
the missing configuration. It does not silently substitute sample data.

For live use, configure:

- `SOURCING_API_BASE_URL`: the sourcing backend's origin, without an API path.
- `SOURCING_INTERNAL_APP_API_KEY`: a secret matching the backend's internal key.
- `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`: matching keys from the
  intended Clerk application. Preserve the existing identity provider.
- `INTERNAL_APP_ALLOWED_USER_IDS` and/or `INTERNAL_APP_ALLOWED_ORG_IDS`: approved
  Clerk identities.
- `CLERK_AUTHORIZED_PARTIES`: this app's HTTPS origin(s), required in production.

Add credentials through Secrets, never source files. Restart the workflow after
configuration changes; the publishable key also requires rebuilding for production.

Only when explicitly requested, the repository supports an isolated sample-data
preview with `SOURCE_MODE=mock AUTH_MODE=dev npm run dev`. It uses in-memory data
and development sign-in, and neither mode is allowed in production.

## Checks

- `npm run typecheck`
- `npm test`
- `npm run build` (also checks the browser bundle for secrets)

## Publishing

The imported `.replit` already specifies `npm ci && npm run build`, followed by
`npm run start`, on port 5000. Configure the real backend, Clerk keys, allowlists,
and production authorized origins before publishing. No database or provider
credentials belong in this app. See README.md for the backend setup contract.
