# Packaging assets

This directory is the only source for release-package artwork. Do not copy images from the ignored local `build/` directory or add screenshots, DMG backgrounds, or other artwork until the maintainer approves each file for publication.

`icon.png` is the maintainer-approved generated application icon used by Electron Builder for Linux, macOS, and Windows packages. Verify its platform-specific conversion in the native release jobs.

The `aur/` directory contains the source recipe for the `scroll-reader-bin` AUR package. Keep its `PKGBUILD` and generated `.SRCINFO` synchronized with each stable GitHub release. The recipe installs only the published Linux archive, this approved icon, the desktop entry, and the MIT license.
