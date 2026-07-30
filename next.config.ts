import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // TypeScript 7 is the native compiler and drops the JS API Next.js used to call.
    // This routes type-checking through the `tsc` CLI instead.
    useTypeScriptCli: true,
  },
};

export default nextConfig;
