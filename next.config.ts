import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "mysql2", "mssql", "mongodb", "tedious"],
  outputFileTracingIncludes: {
    "/api/*": [
      "./node_modules/pg/**",
      "./node_modules/mysql2/**",
      "./node_modules/mssql/**",
      "./node_modules/mongodb/**",
      "./node_modules/tedious/**",
    ],
  },
};

export default nextConfig;
