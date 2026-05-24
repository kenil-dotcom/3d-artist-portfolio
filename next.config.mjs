/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allow `sharp`, `argon2`, and AWS SDK to run as native server-only modules.
  experimental: {
    serverComponentsExternalPackages: ['sharp', 'argon2', '@aws-sdk/client-s3'],
    // Lift the server action body cap from the 1 MB default so the
    // admin CMS can accept large image / video uploads. R2 + the
    // 5 GB validator ceiling are the real backstops; this just
    // tells Next.js to accept the request body in the first place.
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  images: {
    // The portfolio's media pipeline emits its own AVIF/WebP variants
    // and serves them with content-hashed, immutable URLs through the CDN
    // (see Design - Caching and revalidation, Property 9). The Next.js
    // built-in image optimizer is therefore disabled to keep variant
    // selection deterministic and testable.
    unoptimized: true,
    formats: ['image/avif', 'image/webp'],
    // Allow the public site to render images from the R2 public bucket
    // and from any CDN configured via CDN_BASE_URL.
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.cloudflarestorage.com' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
  // Security headers are also asserted in `middleware.ts` (Requirement 12.2).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
