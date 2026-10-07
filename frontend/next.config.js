// frontend/next.config.js
/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development'

// Resolve the FastAPI origin the /api/* rewrite proxies to.
//
// The value is pasted into a hosting dashboard by hand, so it arrives in a few
// shapes: with a trailing slash, with a trailing "/api", or without a scheme.
// Next joins it with the matched path verbatim, so an un-normalised
// "https://host.onrender.com/api" proxies /api/check-access to
// https://host.onrender.com/api/check-access — a path the API has no route for,
// making every call fail with {"detail":"Not Found"}. Normalise to a bare origin.
function resolveBackendOrigin() {
  const raw = (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8000'
  ).trim()

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  return withScheme
    .replace(/\/+$/, '')      // drop trailing slashes
    .replace(/\/api$/i, '')   // drop a trailing /api segment
}

// Content-Security-Policy without nonces. Every page is prerendered at build
// time, and nonces need a fresh server render per request (Next's CSP guide),
// which would make every page dynamic. Next's own inline bootstrap/flight-data
// scripts and React's style attributes therefore need 'unsafe-inline'; the
// policy still pins where scripts, data, fonts and frames may come from and
// forbids framing, plugins, <base> hijacking and off-site form posts.
function contentSecurityPolicy() {
  let backend = null
  try {
    backend = new URL(resolveBackendOrigin()).origin
  } catch {
    // Unparseable API_URL: the rewrite fails loudly anyway; keep the policy valid.
  }

  const directives = {
    'default-src': ["'self'"],
    // React needs eval only in development (error stack reconstruction).
    'script-src': ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    // Video thumbnails come from many platform CDNs.
    'img-src': ["'self'", 'https:', 'data:', 'blob:'],
    // /api goes through the same-origin rewrite; the download progress stream
    // (EventSource) and the YouTube check connect to FastAPI directly. Dev
    // adds websockets for hot reload.
    'connect-src': ["'self'", ...(backend ? [backend] : []), ...(isDev ? ['ws:', 'wss:'] : [])],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }

  // No upgrade-insecure-requests: under `next start` on http://localhost
  // (even against the https API) it would rewrite every same-origin asset
  // request to https and break the page; the deployed site is https-only anyway.
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Browsers ignore this on plain-http responses, so local `next start` is unaffected.
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000' }]),
]

const nextConfig = {
  // The dev-only route badge sits bottom-left, on top of the admin panel's
  // mobile tab bar. Compile and runtime errors are still shown without it.
  devIndicators: false,
  // Don't advertise the framework version.
  poweredByHeader: false,
  // EventSource must connect straight to FastAPI. Next's rewrite proxy can
  // buffer text/event-stream responses and deliver all progress events only
  // after the download has completed.
  env: {
    NEXT_PUBLIC_BACKEND_ORIGIN: resolveBackendOrigin(),
  },
  async headers() {
    return [
      {
        // Every page and static file. /api/* is proxied to FastAPI, which sets
        // its own hardening headers (no-referrer, no-store) on those responses.
        source: '/((?!api(?:/|$)).*)',
        headers: securityHeaders,
      },
    ]
  },
  async rewrites() {
    const backendUrl = resolveBackendOrigin()

    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ]
  },
}
module.exports = nextConfig
