# Security

This project is designed to run locally and to request read-only broker access.

- Never commit `.env.local`, `.data/`, broker statements, account exports, access tokens, or account identifiers.
- Keep TWS / IB Gateway bound to localhost, enable read-only API access, and allow only trusted local clients.
- Do not expose the local bridge port to the public internet.
- Review `git status --ignored` before every public release.

Please report a vulnerability privately to the repository owner instead of opening a public issue containing credentials or account data.
