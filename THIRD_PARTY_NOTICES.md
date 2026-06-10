# Third-Party Notices

This project vendors a small browser WASM build from `zhtw-mcp` for
deterministic Traditional Chinese language-convention checks in the extension
side panel.

For public Alpha release, keep this notice in the root of the release source
and preserve the vendored license file.

## zhtw-mcp

- Public project: https://github.com/sysprog21/zhtw-mcp
- Source commit: `9b977caaa4671473d4175828ed1d5970761aa192`
- Vendored files:
  - `src/vendor/zhtw-mcp/zhtw_mcp_wasm.js`
  - `src/vendor/zhtw-mcp/zhtw_mcp_wasm.d.ts`
  - `src/vendor/zhtw-mcp/zhtw_mcp_wasm.js.d.ts`
  - `src/vendor/zhtw-mcp/zhtw_mcp_wasm_bg.wasm`
  - `src/vendor/zhtw-mcp/LICENSE`
- Build source: generated from the upstream `extension/build-wasm.sh` flow at
  the source commit above.

`zhtw-mcp` is MIT licensed. The preserved license text is in
`src/vendor/zhtw-mcp/LICENSE`.

The extension build emits the WASM payload as a hashed `dist/assets/*.wasm`
asset.
