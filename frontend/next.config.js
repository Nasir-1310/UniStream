// frontend/next.config.js
/** @type {import('next').NextConfig} */

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

const nextConfig = {
  // EventSource must connect straight to FastAPI. Next's rewrite proxy can
  // buffer text/event-stream responses and deliver all progress events only
  // after the download has completed.
  env: {
    NEXT_PUBLIC_BACKEND_ORIGIN: resolveBackendOrigin(),
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
