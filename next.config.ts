import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "mysql2", "mssql", "mongodb", "tedious"],
};

export default nextConfig;
