# Security review — 2026-09-05

Project: TubeGuard Chrome extension  
Scope: manifest, all source and test files, package manifests, configuration, and documentation  
Languages/frameworks: JavaScript ES modules, Manifest V3, IndexedDB, Chrome extension APIs

## Findings summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 1 |

Dependency audit: 0 vulnerable packages.  
Secrets scan: 0 exposed credentials.

No vulnerabilities were found in the new daily learning analysis implementation.

## Information — legacy stats rendering convention

Confidence: High  
Location: `src/stats/stats.js`

The legacy statistics tables still construct fixed table markup with `innerHTML`. Every user-controlled string in those templates passes through the local HTML escaping function, and the remaining interpolated values are computed numbers or normalized dates, so the reviewed paths do not provide an XSS exploit. This remains contrary to the repository's newer DOM-construction convention and should be replaced when that legacy page is next refactored.

## Data-flow verification

- Messages are allowlisted and authorized by extension page or top-frame YouTube sender before sensitive handlers run.
- The OpenRouter key is accepted only from the options page, stored under an opaque slot in trusted `chrome.storage.local`, and omitted from config responses, IndexedDB records, logs, and exports.
- OpenRouter requests use a fixed HTTPS origin, reject redirects, validate the configured GLM identifier, cap request sizes, and validate structured responses against the requested video/evidence/part tuple.
- Captured page data is bounded and treated as untrusted evidence. Options UI renders it with `textContent`.
- Automatic blocks pass through generation checks, durable outbox staging, explicit ownership, and serialized sync mutations.
- Manifest permissions remain scoped to extension storage/alarms/notifications/tabs, YouTube, and OpenRouter. The extension CSP remains `script-src 'self'; object-src 'none'`.

## Verification

- `npm.cmd audit --json`: 0 vulnerabilities across 143 dependencies.
- Secret-pattern scan: only synthetic test credentials were found; none match deployable provider credentials.
- Dangerous-sink scan: no `eval`, `Function`, command execution, dynamic code loading, or new dynamic `innerHTML` use.
- Unit suite: 52 tests passed.
- Packaged extension browser test: passed.

This was a static review plus the implemented browser integration test. It cannot prove the behavior of future YouTube DOM or caption endpoint changes.
