import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (Postgres compiled to WASM) runs only in the browser.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
