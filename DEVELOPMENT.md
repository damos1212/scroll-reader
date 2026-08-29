# Development guide

## Toolchain

Scroll Reader uses Node.js 26.7.0, npm 11.19.0, TypeScript, Vite, Vitest, Electron, and electron-builder. `mise.toml` selects the Node.js runtime. `package-lock.json` is the authoritative dependency lockfile.

Do not use Bun or edit generated output directly.

## Set up the repository

1. Inspect `mise.toml` if `mise` asks you to trust it.
2. Run `mise install` if the pinned runtime is unavailable.
3. Run `npm ci`.
4. Run `npm run check`.

The `allowScripts` policy in `package.json` permits the Electron and esbuild installers and denies unrelated transitive install scripts. The `@xmldom/xmldom` override keeps EPUB.js on the patched XML parser used by the repository verifier.

## Commands

- `npm test`: run the unit suite once.
- `npm run test:watch`: run tests in watch mode.
- `npm run build`: build the renderer and Electron main process.
- `npm run check`: run tests and a production build.
- `npm run start`: build and launch the development window.
- `npm run dist`: build the unpacked Linux application in `release/`.
- `npm run package:linux`: build unsigned Linux x64 AppImage and tar.gz packages.
- `npm run package:mac`: build unsigned universal macOS DMG and ZIP packages on macOS.
- `npm run package:windows`: build unsigned Windows x64 installer and portable packages on Windows.
- `npm run verify:epub -- /path/to/book.epub`: run the developer EPUB parser check.

## Architecture

- `electron/main.ts` owns the window, file selection, active-book authorization, archive reads, protocol responses, and network policy.
- `electron/preload.cjs` exposes the narrow renderer bridge.
- `src/main.ts` owns rendering, reading controls, continuous layout, and local position updates.
- `src/state.ts` validates and stores preferences and content-hash-keyed reading positions.
- `src/pdf-layout.ts` validates PDF geometry and decoded-pixel budgets.

The renderer never receives a filesystem path. File-picker, startup, and drag-and-drop inputs are inspected in the main process and replaced by one opaque active-book identifier. Opening another book invalidates the previous identifier.

## Resource limits

The main process rejects:

- general books larger than 1 GiB;
- buffered EPUB and PDF files larger than 512 MiB;
- TXT files larger than 64 MiB;
- ZIP archives with more than 10,000 entries;
- CBZ files with more than 2,000 image pages, any page larger than 100 MiB expanded, or more than 512 MiB aggregate expanded image data;
- EPUB entries larger than 64 MiB or EPUB archives with more than 512 MiB aggregate expanded data;
- ZIP entries whose expanded-to-compressed ratio exceeds 100:1.

The renderer additionally limits EPUB sections and markup, decoded CBZ and EPUB image pixels, PDF page count, PDF geometry, per-page canvas pixels, and retained PDF canvas pixels.

## Generated files

The following directories are generated and ignored:

- `node_modules/`
- `dist/`
- `dist-electron/`
- `release/`

Root `index-*.js` bundles and the `build/` artwork directory are also ignored. Release packaging reads approved artwork only from `packaging/`, which prevents local images from entering a package accidentally.

## Verification scope

The unit suite covers book ordering, image types, security budget helpers, reader state, EPUB styling, PDF geometry, decoded-pixel budgets, and refresh-rate estimation. Production builds type-check the renderer and Electron main process.

The repository does not yet contain redistributable representative CBZ, EPUB, PDF, or TXT fixtures. Complete startup, IPC, archive, file-association, desktop integration, and visual behavior therefore require manual smoke tests with local books before a release. Test macOS and Windows packages on those operating systems; a successful cross-package build alone is not runtime verification.

## Release automation

The `Package releases` GitHub Actions workflow runs in two modes:

- Start it manually to build downloadable workflow artifacts without publishing a release.
- Push a version tag that matches `package.json`, such as `v0.1.0`, to build packages, create `SHA256SUMS`, and publish a GitHub release.

GitHub builds each package on its native operating system. The macOS and Windows packages deliberately disable certificate discovery and code signing. Do not add signing secrets or an automatic updater unless the maintainer changes this policy.

The workflow publishes Linux x64, Windows x64, and universal macOS packages. Add another architecture only after testing all supported book formats on that architecture.

## Release checklist

1. Run `npm ci` from the lockfile.
2. Run `npm audit --audit-level=high`.
3. Run `npm run check`.
4. Smoke-test CBZ, EPUB, PDF, and TXT books locally.
5. Confirm network requests remain blocked.
6. Run `npm run dist` on Linux.
7. Launch `./run-scroll-reader.sh` from the repository.
8. Run the GitHub packaging workflow manually.
9. Smoke-test the generated Linux, macOS, and Windows packages on their native systems.
10. Confirm the release contains only declared package files and the MIT license.
11. Create a version tag that exactly matches `package.json` only after every required check passes.

After the first stable GitHub release, create `scroll-reader-bin` in the AUR. Its `PKGBUILD` must download the versioned Linux release and license, verify fixed SHA-256 checksums, install the application under `/opt`, and install the approved desktop entry and icon. Validate the package with `makepkg`, `namcap`, installation, launch, file opening, upgrade, and removal tests before submitting it.

Do not publish an AUR package until the public repository URL, release assets, checksum process, and maintainer-approved icon are stable. The AUR repository stores only the packaging recipe, not the generated package or upstream binaries.
