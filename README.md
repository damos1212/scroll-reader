# Scroll Reader

Scroll Reader is a small, local-only desktop reader for CBZ, EPUB, PDF, and TXT books. It presents each book as one continuous document with the normal window scrollbar. The application is designed for Linux, macOS, and Windows and never needs network access to read a book.

The repository includes a generated application icon approved by the maintainer. It does not include screenshots or other promotional images.

## Features

- CBZ pages use a continuous, fit-to-width layout.
- EPUB spine sections preserve publisher typography, embedded images, and fonts.
- PDF pages use a continuous, fit-to-width layout with an optional dark-page filter.
- TXT books use a reflowable reading column.
- EPUB and TXT default to a 22 px font and a 760 px text column.
- Reading position and display preferences stay on the local computer.
- Content hashes identify books, so a moved or renamed file keeps its saved position.

## Privacy and security

Scroll Reader treats every book as untrusted input.

- Electron context isolation and renderer sandboxing are enabled.
- Renderer Node.js integration is disabled.
- EPUB scripts, popups, and top-level navigation are disabled.
- Electron blocks HTTP, HTTPS, WebSocket, and FTP requests at the session boundary.
- The renderer receives an opaque active-book identifier instead of a filesystem path.
- The main process validates the selected regular file before privileged reads.
- Archives stay in memory and are never extracted to disk.
- Format-specific limits bound compressed books, archive entries, expanded bytes, pages, markup, decoded images, and PDF canvases.

See `SECURITY.md` to report a vulnerability privately.

## Requirements

- Linux, macOS, or Windows for packaged releases
- Linux, `mise`, and the distribution's Electron runtime libraries for the repository-local launcher described below
- Node.js and npm versions selected by `mise.toml` for development

The repository pins Node.js 26.7.0 in `mise.toml` and npm 11.19.0 in `package.json`.

## Released packages

GitHub releases are prepared to provide:

- an AppImage and compressed application directory for Linux x64;
- a universal DMG and ZIP for Intel and Apple silicon Macs;
- an installer and portable executable for Windows x64;
- a `SHA256SUMS` file for verifying every download.

The Windows and macOS packages are intentionally unsigned because this project does not use paid signing services. Windows can display an unknown-publisher warning. macOS can require approval in **System Settings > Privacy & Security** before the first launch.

The application does not contain an automatic updater. Download future versions from the project's GitHub releases or update through a distribution package.

## Build and run from this repository on Linux

```bash
mise install
npm ci
npm run check
npm run dist
```

After the unpacked build completes, launch it from the repository:

```bash
./run-scroll-reader.sh
```

You can also pass a book directly:

```bash
./run-scroll-reader.sh "/path/to/book.cbz"
```

The launcher runs `release/linux-unpacked/scroll-reader`. It does not install files in `/usr/bin`, `~/.local/bin`, or the desktop application directory.

For an interactive development window, run:

```bash
npm run start
```

## Controls

- `Ctrl+O`: open a book
- `Ctrl` + mouse wheel: zoom the reader content in or out around the pointer
- Left-click and drag: pan the reader while zoomed above 100%
- `+` or `-`: change reflowable text size
- `F11`: toggle fullscreen
- `Home`: scroll to the beginning

Move the pointer into the top 80 pixels of the window to reveal the toolbar. Select the zoom percentage to return to 100%. Image zoom uses the original CBZ and EPUB image data. Use the font label and width button to return EPUB content to its publisher settings. Scroll Reader requests SDR sRGB output so fullscreen does not activate HDR.

## Verification

`npm run check` runs the unit suite, TypeScript checks, and production builds. `npm run dist` additionally builds the unpacked Linux application. The `package:linux`, `package:mac`, and `package:windows` commands create release packages on their respective operating systems. See `DEVELOPMENT.md` for coverage and release details.

## Packaging roadmap

GitHub Actions can build all release packages manually without publishing them. A version tag such as `v0.1.0` publishes the matching packages and checksums as a GitHub release.

The first Arch User Repository package will be named `scroll-reader-bin`. It will install a prebuilt Linux release through Arch's normal package workflow. The AUR recipe will be added only after the public repository URL and first stable release exist.

## Contributing

Read `CONTRIBUTING.md` before proposing a change. Keep the application offline, preserve the Electron security boundary, and do not add images without maintainer approval.

## License

Scroll Reader is available under the [MIT License](LICENSE).
