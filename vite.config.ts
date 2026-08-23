// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

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
          const source = "public/runtime-build-id.txt";
          const destinationDir = ".output/public";
          const destination = `${destinationDir}/runtime-build-id.txt`;
          if (!existsSync(source)) {
            throw new Error(`Runtime build identity source is missing: ${source}`);
          }
          mkdirSync(destinationDir, { recursive: true });
          copyFileSync(source, destination);
          console.log(`Preserved runtime build identity at ${destination}`);
        },
      },
    ],
  },
});
