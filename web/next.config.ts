import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this directory — without it, Next.js/Turbopack walks up
  // looking for lockfiles and can land on an unrelated one elsewhere on the machine
  // (this repo has no lockfile above web/, so there's nothing to actually share).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
