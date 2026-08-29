# Security policy

## Supported versions

Scroll Reader is pre-1.0 software. Security fixes are applied to the current main branch only.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's private GitHub security advisory feature and include:

- the affected version or revision;
- the supported book format and smallest safe reproduction details;
- the expected and observed behavior;
- the security impact;
- any relevant logs without private book contents or local paths.

You should receive an acknowledgment within seven days. Do not attach copyrighted books or personal reading data unless the maintainer asks for a minimal, redistributable fixture.

## Security boundaries

Scroll Reader treats every book as untrusted. It blocks HTTP, HTTPS, WebSocket, and FTP requests, keeps privileged filesystem access in the Electron main process, uses an opaque active-book capability, disables renderer Node.js integration, enables context isolation and renderer sandboxing, disables EPUB scripts and inline data images, and applies format-specific resource limits.
