# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.2.x   | ✅ Active releases |

## Reporting a Vulnerability

LENS is an open-source qualitative data analysis desktop tool. We take
security seriously.

**Please do not report vulnerabilities via public GitHub issues.**

Instead, send details to the maintainer directly via email or by
opening a **draft security advisory** on GitHub:

1. Go to https://github.com/mabo-du/lens/security/advisories
2. Click **New draft security advisory**
3. Fill in the description, severity, and steps to reproduce

You can expect an acknowledgement within 48 hours and a fix timeline
proportional to the severity. Critical issues are prioritised over
feature work.

## Scope

- **In scope:** The Tauri 2 Rust backend, the React/TypeScript renderer,
  the `lens-qda` Python CLI companion, the PDF extraction sidecar, the
  CI/CD pipeline (`release.yml`, `ci.yml`), and the SQLite data layer.
- **Out of scope:** Third-party actions pinned in `.github/workflows/`
  (report those upstream), the GitHub / GitLab repository configurations,
  and the Apple Developer / notarisation infrastructure.

## Security-Related Configuration

### Branch Protection

The `main` branch should have branch protection rules enabled:
- Require pull request reviews before merging
- Require status checks to pass
- Require branches to be up-to-date

### Secrets

Repository secrets (signing keys, Apple credentials) are stored in
GitHub Actions secrets — never in the source tree. The helper script
`scripts/set-release-credentials.sh` wires these via `gh secret set`.
Secret-named documentation (`docs/release-credentials-catalog.md`) exists as
reference only and contains no actual secret values.

### Dependency Auditing

npm dependencies are audited via `npm audit` in CI (`ci.yml`). Python
dependencies are audited via `pip-audit` where configured.
