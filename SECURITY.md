# Security Policy

## Supported Versions

Truly is currently preparing for an Alpha release. Security fixes target the
latest Alpha branch and the latest tagged Alpha package.

## Reporting A Vulnerability

Please report security issues privately when possible. Use GitHub private
vulnerability reporting if it is enabled for the public repository. If private
reporting is not yet available, open a minimal issue that describes the impact
without posting exploit details, private data, tokens, or endpoint secrets.

Helpful reports include:

- the affected Truly version or commit;
- the browser and operating system;
- the steps needed to reproduce the issue;
- whether the issue involves extension permissions, local model endpoints,
  clipboard/download behavior, or external-tool handoff.

## Scope

Security issues include permission overreach, unintended data sharing,
cross-origin endpoint mistakes, extension storage exposure, and unsafe handling
of model output.

Model quality, incorrect summaries, or ordinary false positives are product
bugs rather than security vulnerabilities unless they cause data exposure or
unsafe automation.
