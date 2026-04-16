# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do NOT open a public issue.**
2. Send an email to: ty.kim@modusign.co.kr
3. Include a description of the vulnerability, steps to reproduce, and potential impact.
4. Allow up to 72 hours for initial response.

## Token Security

This tool stores Akiflow authentication tokens locally:

- **Location**: `~/.config/akiflow/auth.json`
- **Permissions**: `0600` (owner read/write only)
- **Content**: `accessToken`, `refreshToken`, `clientId`

### Important

- **NEVER** commit `auth.json` or tokens to Git.
- **NEVER** share your `AKIFLOW_REFRESH_TOKEN` environment variable.
- **NEVER** post token values in issues or discussions.
- Log output automatically masks JWT and token patterns (see ADR-0009).

## Supported Versions

Only the latest release receives security fixes.
