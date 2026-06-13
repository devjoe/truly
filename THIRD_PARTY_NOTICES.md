# Third-Party Notices

This project vendors a small browser WASM build from `zhtw-mcp` for
deterministic Traditional Chinese language-convention checks in the extension
side panel.

For public Alpha release, keep this notice in the root of the release source
and preserve the vendored license file.

## audreyt/pi-ds4

Truly adapts the stakeholder-framing prompt wording documented in
`audreyt/pi-ds4` for contested-context analysis. The conditional prompting
pattern around that wording is Truly-specific.

- Public project: https://github.com/audreyt/pi-ds4
- Source: `README.md`, Directional steering section
- License: MIT
- Copyright: Copyright (c) 2026 Armin Ronacher

MIT permission notice for the adapted source material:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.

## zhtw-mcp

- Public project: https://github.com/sysprog21/zhtw-mcp
- Source commit: `9b407b7bce3c603a0ade221d248eec1a0f531335`
- Local patch: `src/vendor/zhtw-mcp/truly-wasm-build.patch` makes two changes
  at the source commit before building: (1) exposes the upstream `detect_ai`
  capability (AI writing-artifact detection) through the WASM `scan_text`
  options and adds the optional `ai_signature` field to the scan result;
  (2) narrows the `regex` crate to `std`/`perf`/`unicode-perl` features,
  dropping ~275 KB of Unicode tables the scan patterns never use (verified
  against the full upstream test suite and behavior-identical scan output).
- Vendored files:
  - `src/vendor/zhtw-mcp/zhtw_mcp_wasm.js`
  - `src/vendor/zhtw-mcp/zhtw_mcp_wasm.d.ts`
  - `src/vendor/zhtw-mcp/zhtw_mcp_wasm.js.d.ts`
  - `src/vendor/zhtw-mcp/zhtw_mcp_wasm_bg.wasm`
  - `src/vendor/zhtw-mcp/truly-wasm-build.patch`
  - `src/vendor/zhtw-mcp/LICENSE`
- Build source: upstream `extension/build-wasm.sh` flow at the source commit
  above with the local patch applied, built size-optimized and then shrunk
  with `wasm-opt`:

  ```bash
  CARGO_PROFILE_RELEASE_OPT_LEVEL=z CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
    bash extension/build-wasm.sh
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int \
    --enable-sign-ext --enable-mutable-globals --enable-reference-types \
    --strip-debug --strip-producers \
    extension/dist/zhtw_mcp_wasm_bg.wasm -o zhtw_mcp_wasm_bg.wasm
  ```

`zhtw-mcp` is MIT licensed. The preserved license text is in
`src/vendor/zhtw-mcp/LICENSE`.

The extension build emits the WASM payload as a hashed `dist/assets/*.wasm`
asset.
