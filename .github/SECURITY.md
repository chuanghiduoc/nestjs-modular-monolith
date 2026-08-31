# Security policy

## Reporting a vulnerability

Report privately through GitHub's **Report a vulnerability** button on the
Security tab. Do not open a public issue, and do not include a working exploit
in the first message.

A report is most useful with: the version or commit, the request that triggers
it, what an attacker gains, and whether it needs an authenticated session.

Expect an acknowledgement within 3 working days and an assessment within 10.

## Supported versions

This is a boilerplate: only `main` is supported. A fork carries its own
security responsibility from the moment it is created.

## What is in scope

Anything that lets a caller read or change data they should not, bypass the
authentication or authorization path, or take the service down with a single
cheap request.

## What is out of scope

- Findings that require an attacker to already hold the database credentials,
  `BETTER_AUTH_SECRET`, or shell on the host.
- Missing headers or configuration on a **deployment** rather than in this repo.
- Rate limits being reachable at all: they are budgets, not a denial-of-service
  defence, and the numbers are deployment configuration.
- Anything in `docker/compose.dev.yml` — the dev stack ships weak credentials on
  purpose and is documented as never being production.

## What this repo already does about the common ones

| Concern                                  | Where                                                               |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Credential stuffing                      | Per-IP and per-account rate limits on credential paths              |
| Session fixation after a password change | `revokeSessionsOnPasswordReset`                                     |
| User enumeration                         | Better Auth answers every failed sign-in identically                |
| Secrets in logs                          | Redaction paths in the logger configuration                         |
| Secrets in the image                     | Multi-stage build, no build args carrying secrets, `.dockerignore`  |
| Dependency and image CVEs                | `osv-scanner` and `trivy` gate merges; Dependabot opens the upgrade |
| Least privilege in Postgres              | `ops/postgres/roles.sql`, asserted by an integration test           |
