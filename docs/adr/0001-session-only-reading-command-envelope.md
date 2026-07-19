# Use a session-only command envelope for cold Side Panel handoff

Status: accepted

The MV3 service worker may stop before the Side Panel is ready, so a timed
`runtime.sendMessage` retry is not a reliable handoff. Truly will store only a
consume-once Reading Command Envelope in `chrome.storage.session`, then use a
broadcast as an optional low-latency hint; the Side Panel consumes and removes
the envelope before starting extraction. The envelope may contain request,
tab, activation, and timestamp metadata, but never extracted page text, model
input, analysis output, screenshots, or Page Reading Session history.

## Considered Options

- Repeated timer broadcasts were rejected because Side Panel readiness and MV3
  service-worker lifetime are not timer contracts.
- Persisting the latest reading result was rejected because it would violate
  the current session-only privacy decision.
- Keeping the service worker alive was rejected because service-worker
  suspension is a platform lifecycle, not an error to bypass.

## Consequences

- Side Panel cold-open recovery replays an instruction, not user content.
- Envelopes require request identity, a short expiry, consume-once removal, and
  stale-tab validation.
- Durable Page Reading Session history still requires a separate privacy and
  storage decision.
