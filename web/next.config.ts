import path from "path";
import type { NextConfig } from "next";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  // Pin the workspace root to this directory — without it, Next.js/Turbopack walks up
  // looking for lockfiles and can land on an unrelated one elsewhere on the machine
  // (this repo has no lockfile above web/, so there's nothing to actually share).
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Browser calls stay same-origin (localhost:3000/api/backend/...) so the httpOnly
  // `session` cookie set by our own login route is sent automatically; Next's server
  // then forwards the request (cookie included) to FastAPI server-to-server. This avoids
  // CORS-with-credentials entirely and keeps the JWT out of client JS reach.
  async rewrites() {
    return [{ source: "/api/backend/:path*", destination: `${API_BASE}/:path*` }];
  },
};

export default nextConfig;
