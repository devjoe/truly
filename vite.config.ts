import { defineConfig, build, type Plugin } from "vite";
import { resolve } from "path";
import { cpSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const isFirefox = process.env.VITE_BROWSER === "firefox";

// Build ID: epoch-ms + 7-char git SHA (+ "-dirty" if uncommitted changes).
// Stamped into every entry point via `define` so we can detect at runtime
// when Chrome's MV3 SW cache is serving stale code from a previous build.
function computeBuildId(): string {
  const ts = Date.now();
  let sha = "nogit";
  let dirty = "";
  try {
    sha = execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    const status = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    if (status.length > 0) dirty = "-dirty";
  } catch { /* not a git repo */ }
  return `${ts}-${sha}${dirty}`;
}

let activeBuildId = computeBuildId();

function buildIdReplacePlugin(opts: {
  getBuildId: () => string;
  refreshOnBuildStart?: boolean;
}): Plugin {
  return {
    name: "truly-build-id-replace",
    buildStart() {
      if (opts.refreshOnBuildStart) {
        activeBuildId = computeBuildId();
        console.log(`[vite] BUILD_ID=${activeBuildId}`);
      }
    },
    renderChunk(code) {
      return {
        code: code.replace(/\b__TRULY_BUILD_ID__\b/g, JSON.stringify(opts.getBuildId())),
        map: null,
      };
    },
  };
}

function copyStaticAssets(): Plugin {
  return {
    name: "copy-static-assets",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      const src = resolve(__dirname, "src");

      cpSync(`${src}/manifest.json`, `${dist}/manifest.json`);
      cpSync(`${src}/popup/popup.html`, `${dist}/popup/popup.html`);
      cpSync(`${src}/options/options.html`, `${dist}/options/options.html`);
      cpSync(
        `${src}/content_scripts/feed-filter.css`,
        `${dist}/content_scripts/feed-filter.css`
      );
      cpSync(`${src}/_locales`, `${dist}/_locales`, { recursive: true });
      mkdirSync(`${dist}/sidepanel`, { recursive: true });
      cpSync(`${src}/sidepanel/sidepanel.html`, `${dist}/sidepanel/sidepanel.html`);
      mkdirSync(`${dist}/icons`, { recursive: true });
      try {
        cpSync(`${src}/icons`, `${dist}/icons`, { recursive: true });
      } catch {}
    },
  };
}

function syncHeadsUpStyles(): Plugin {
  return {
    name: "sync-heads-up-styles",
    buildStart() {
      execSync("node scripts/sync-headsup-styles.mjs", { stdio: "inherit" });
    },
  };
}

// Build content script separately as IIFE (self-contained, no imports)
function buildContentScriptIIFE(): Plugin {
  return {
    name: "build-content-script-iife",
    async closeBundle() {
      const buildId = activeBuildId;
      const buildIdPlugin = buildIdReplacePlugin({ getBuildId: () => buildId });

      // Build content script (IIFE)
      await build({
        configFile: false,
        plugins: [buildIdPlugin],
        build: {
          outDir: "dist/content_scripts",
          emptyOutDir: false,
          sourcemap: true,
          lib: {
            entry: resolve(__dirname, "src/content_scripts/feed-filter.ts"),
            formats: ["iife"],
            name: "Truly",
            fileName: () => "feed-filter.js",
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        },
        define: {
          __BROWSER__: JSON.stringify(isFirefox ? "firefox" : "chrome"),
        },
      });

      // Build GraphQL interceptor (IIFE, injected into MAIN world)
      await build({
        configFile: false,
        plugins: [buildIdPlugin],
        build: {
          outDir: "dist/content_scripts",
          emptyOutDir: false,
          sourcemap: false,
          lib: {
            entry: resolve(
              __dirname,
              "src/content_scripts/graphql-interceptor.ts"
            ),
            formats: ["iife"],
            name: "TrulyInterceptor",
            fileName: () => "graphql-interceptor.js",
          },
        },
      });

      // Build service worker (IIFE for non-module SW)
      await build({
        configFile: false,
        plugins: [buildIdPlugin],
        build: {
          outDir: "dist/background",
          emptyOutDir: false,
          sourcemap: true,
          lib: {
            entry: resolve(__dirname, "src/background/service-worker.ts"),
            formats: ["iife"],
            name: "TrulyBackground",
            fileName: () => "service-worker.js",
          },
        },
      });

    },
  };
}

function writeBuildIdFile(): Plugin {
  return {
    name: "write-build-id-file",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      // Write after all root and nested extension bundles are complete.
      // dev-reload-server polls this file as the canonical reload signal.
      writeFileSync(`${dist}/build-id.txt`, activeBuildId);
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    // Chrome loads the unpacked extension directly from `dist/` in dev.
    // Emptying the directory at build start creates a brief missing-file
    // window where Chrome can disable the extension during reload.
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        "popup/popup": resolve(__dirname, "src/popup/popup.ts"),
        "options/options": resolve(__dirname, "src/options/options.ts"),
        "sidepanel/sidepanel": resolve(__dirname, "src/sidepanel/sidepanel.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        format: "es",
      },
    },
  },
  plugins: [
    buildIdReplacePlugin({ getBuildId: () => activeBuildId, refreshOnBuildStart: true }),
    syncHeadsUpStyles(),
    copyStaticAssets(),
    buildContentScriptIIFE(),
    writeBuildIdFile(),
  ],
  define: {
    __BROWSER__: JSON.stringify(isFirefox ? "firefox" : "chrome"),
  },
});
