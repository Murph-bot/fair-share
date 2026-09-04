import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const domainIndex = fileURLToPath(new URL("../packages/domain/src/index.ts", import.meta.url));
const domainRoot = fileURLToPath(new URL("../packages/domain/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@fairshare\/domain$/,
        replacement: domainIndex,
      },
      {
        find: /^@fairshare\/domain\/(.*)$/,
        replacement: `${domainRoot}/$1`,
      },
    ],
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
