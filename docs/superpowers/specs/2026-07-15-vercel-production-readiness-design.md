# Vercel Pro production readiness

## Goal

Prepare the existing Next.js application for reliable deployment on Vercel Pro without changing its architecture or sending credentials to server-side environment variables. The application continues to receive the selected OpenAI-compatible provider configuration in request headers from browser local storage.

## Runtime and deployment configuration

Declare Node.js `>=20.9.0` in `package.json`, matching the installed Next.js requirement and making local, CI, and Vercel runtime expectations explicit.

Set a 90-second maximum duration on every Node.js API route that can call an external vision model. The per-route setting matches the existing model-client abort timeout, allowing the application to return its controlled timeout error before the Vercel function terminates.

No `vercel.json` is needed for the selected approach. Vercel will use the existing `npm run build` command and Next.js route discovery.

## Image request limit

Limit client-side image selection to 3 MiB. Keep server-side validation authoritative by limiting the incoming data URL to the base64-equivalent maximum for 3 MiB plus the data-URL metadata allowance. The UI error text and server error response must describe the same 3 MiB limit.

The browser still sends the image as a data URL in JSON. This keeps the current API contract and avoids a storage service, deployment environment variables, and public-object access concerns.

## Error handling

Existing malformed-request, provider, connection, and upstream-timeout handling remains intact. The new size validation rejects oversized inputs before external model calls. Routes retain the Node.js runtime because the model client depends on Node networking modules.

## Test coverage and verification

Add focused route-handler tests that cover:

- rejecting an image request that exceeds the 3 MiB data-URL limit;
- preserving the configured timeout behavior for external model calls;
- converting provider failures into the documented API error response.

Run lint, strict TypeScript checking, unit tests, and `next build`. Update the README with Vercel Pro deployment steps, Node.js version requirement, 3 MiB image limit, and the 90-second function-duration expectation.

## Scope exclusions

This work does not add Vercel Blob, remote file storage, telemetry, managed secrets, or an external deployment. These are unnecessary for the selected 3 MiB image flow and would introduce new infrastructure and configuration requirements.
