/**
 * Hermetic e2e daemon stub — the deliberate answer for the FEW requests the
 * in-page mocks cannot intercept.
 *
 * Almost every daemon call in the e2e suite is answered in the browser by
 * installMockDaemon / installChatMockDaemon (Playwright page routes). The one
 * structural exception: requests made while a REAL service worker controls the
 * page (the PWA specs) — Playwright's page routing does not see those, so they
 * flow through the vite dev proxy to this port.
 *
 * Before this stub existed the proxy target was a dead port, so those requests
 * died as ECONNREFUSED — dozens of "http proxy error" lines per run that made
 * the suite look like it was passing vacuously against a refused connection.
 * Now every escaped request gets a deliberate 503 with an unmistakable code,
 * and a clean run's webServer log is silent.
 *
 * The stub answers 503 (not 200) on purpose: it must never impersonate a
 * healthy daemon. Specs that need daemon data must mock it in-page; anything
 * reaching this stub renders the app's honest daemon-error states.
 */
const port = Number(process.env.GOODVIBES_E2E_STUB_PORT ?? 59991);

try {
  Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(request) {
      const url = new URL(request.url);
      // Liveness endpoint for Playwright's webServer readiness poll only.
      if (url.pathname === '/__stub-alive') {
        return new Response('ok', { status: 200 });
      }
      return Response.json(
        {
          error: 'hermetic e2e stub: no real daemon behind this port; mock this route in-page',
          code: 'E2E_STUB',
        },
        { status: 503 },
      );
    },
  });
  console.log(`[e2e-daemon-stub] answering deliberate 503s on 127.0.0.1:${port}`);
} catch (err) {
  // A sibling worktree's identical stub already owns the port — reuse is safe
  // because every instance serves the same static answers.
  console.log(`[e2e-daemon-stub] port ${port} already served (reusing): ${String(err)}`);
}
