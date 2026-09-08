// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  BUILD_ID_ASSET,
  isStampedReleaseIdentity,
  mergeNoStoreHeaderRule,
  resolveBuildId,
} from "./src/lib/build-identity/stamp";

// Every directory that a Cloudflare deploy may serve static assets from.
// The nitro/cloudflare target emits `dist/client`; older/alternate layouts
// use `.output/public`. Stamping all of them keeps the deployed identity
// asset authoritative regardless of which layout the build produces.
const ASSET_DIRECTORIES = ["dist/client", ".output/public"];

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      {
        name: "preserve-runtime-build-id",
        enforce: "post",
        closeBundle() {
          const source = `public/${BUILD_ID_ASSET}`;
          const existing = existsSync(source) ? readFileSync(source, "utf8") : undefined;
          // GitHub Actions provides GITHUB_SHA; Cloudflare Workers Builds provides
          // WORKERS_CI_COMMIT_SHA. Either CI identity must override a stale on-disk value.
          const buildId = resolveBuildId(
            process.env.GITHUB_SHA ?? process.env.WORKERS_CI_COMMIT_SHA,
            existing,
          );
          writeFileSync(source, `${buildId}\n`);

          for (const destinationDir of ASSET_DIRECTORIES) {
            if (destinationDir !== "dist/client" && !existsSync(destinationDir)) {
              mkdirSync(destinationDir, { recursive: true });
            }
            if (!existsSync(destinationDir)) continue;
            writeFileSync(`${destinationDir}/${BUILD_ID_ASSET}`, `${buildId}\n`);
            const headersPath = `${destinationDir}/_headers`;
            const currentHeaders = existsSync(headersPath)
              ? readFileSync(headersPath, "utf8")
              : undefined;
            writeFileSync(headersPath, mergeNoStoreHeaderRule(currentHeaders));
          }

          console.log(
            `Runtime build identity stamped as ${buildId}` +
              (isStampedReleaseIdentity(buildId) ? " (release)" : " (local)"),
          );
        },
      },
    ],
  },
});
