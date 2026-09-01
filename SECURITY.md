# Security policy

## Supported code

Security fixes target the latest commit on `main`. Older commits, forks,
private deployments, and modified builds are not independently supported.

Reroll is designed for a trusted small team and a single service instance. It
binds to `127.0.0.1` by default. Internet exposure requires an HTTPS reverse
proxy, secure cookies, explicit trusted origins, access controls, backups, and
normal host hardening; changing the bind address does not provide those
controls automatically.

## Report a vulnerability privately

Do not open a public Issue for an unpatched vulnerability or include live
credentials, private media, Workspace data, or exploit details in logs.

Use the repository's
[private vulnerability reporting form](https://github.com/lazyq666/reroll-ai-canvas/security/advisories/new).
Include the affected commit, deployment assumptions, reproduction steps,
impact, and the smallest safe proof of concept. Remove secrets and personal
data before attaching diagnostics.

If private reporting is temporarily unavailable, contact the repository owner
through their GitHub profile without disclosing technical details publicly,
then wait for a private channel before sending the report.

## Coordinated disclosure

Please allow time to reproduce, fix, test, and distribute an update before
public disclosure. The maintainer will keep the reporter informed of material
status changes and credit the reporter unless anonymity is requested.

Reports about third-party providers should also follow the provider's own
security process. A provider outage, model behavior disagreement, or ordinary
support request is not a vulnerability in this repository.
