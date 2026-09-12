import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages:['pdfjs-dist','@napi-rs/canvas'],
  outputFileTracingIncludes: { "/api/p5-estimator/*": ["./node_modules/heic-convert/**/*", "./node_modules/heic-decode/**/*", "./node_modules/libheif-js/**/*", "./node_modules/jpeg-js/**/*", "./node_modules/pngjs/**/*", "./node_modules/pdfjs-dist/**/*", "./node_modules/@napi-rs/canvas*/**/*"] },
  allowedDevOrigins: ["terminal.local", ...(process.env.REPLIT_DEV_DOMAIN ? [process.env.REPLIT_DEV_DOMAIN] : [])],
  async redirects() {
    return [
      // www.p5homeco.com answers 200 with the same content as the apex host.
      // One host keeps crawlers and analytics on a single set of URLs.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.p5homeco.com" }],
        destination: "https://p5homeco.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
