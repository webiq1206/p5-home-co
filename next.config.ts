import type { NextConfig } from "next";

import { execSync } from "node:child_process";
// Release identity: the commit, its tree (unchanged by Replit's empty "Published
// your App" marker commits) and whether the build ran from a modified workspace.
function p5Release() {
  const git = (args: string) => { try { return execSync("git " + args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
  return JSON.stringify({ sha: git("rev-parse HEAD"), tree: git("log -1 --format=%T"), dirty: git("status --porcelain --untracked-files=no") !== "", builtAt: new Date().toISOString() });
}
const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_P5_RELEASE: p5Release() },
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
