/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages are shipped as source-compiled ESM; let Next transpile them.
  transpilePackages: [
    "@okf-anchor/okf-core",
    "@okf-anchor/providers",
    "@okf-anchor/pipeline",
    "@okf-anchor/db",
    "@okf-anchor/queue",
  ],
  serverExternalPackages: ["oxigraph", "bullmq", "ioredis", "@prisma/client", ".prisma/client"],
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/src/generated/**"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // These are CJS / wasm / native and must be require()d from node_modules
      // at runtime, not bundled by webpack.
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        "oxigraph",
        "bullmq",
        "ioredis",
        // Optional bullmq backend we do not use; keeps the build log clean.
        "@valkey/valkey-glide",
      ];
    }
    return config;
  },
};

export default nextConfig;
