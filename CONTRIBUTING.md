# Contributing to Scroll Reader

Thank you for improving Scroll Reader. Keep changes small, local-only, and focused on the continuous-reading experience.

## Before you start

1. Read `README.md` and `DEVELOPMENT.md`.
2. Discuss production dependency changes before implementing them.
3. Use the Node.js and npm versions declared by `mise.toml` and `package.json`.

## Development workflow

1. Run `mise install` if the pinned runtime is unavailable.
2. Run `npm ci`.
3. Add focused tests for the behavior you change.
4. Run `npm run check`.
5. Run `npm run dist` only when the unpacked Linux package must be verified.
6. Run a platform's `package:*` command only when its release package must be verified on that operating system.

Do not edit `dist/`, `dist-electron/`, or `release/` directly. Do not add screenshots, icons, or other images without maintainer approval. Do not add code-signing configuration, release secrets, telemetry, an automatic updater, or runtime network access.

## Security requirements

Preserve these properties:

- The application must not use the network.
- Electron context isolation and renderer sandboxing must remain enabled.
- Renderer Node.js integration must remain disabled.
- EPUB content must remain script-disabled.
- Privileged reads must remain bound to the active book capability.
- Book, archive, entry, markup, page, and decoded-pixel limits must remain enforced.
- Book contents must not be extracted to disk.

Report security problems through the process in `SECURITY.md`.

## Pull requests

Keep each pull request focused. Explain the user-visible result, list the checks you ran, and identify any unverified behavior. Do not include generated output unless the change specifically verifies release packaging.
