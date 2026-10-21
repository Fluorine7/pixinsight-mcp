# Security dependency review — 2026-10-22

Scope: `Fluorine7/pixinsight-mcp`, baseline `e590112`, tracked manifests,
lockfile, runtime requirements, GitHub Actions, and native build declarations.
This is a dependency/advisory review, not a penetration test or a complete audit
of PixInsight, the host OS, or every tool preinstalled on GitHub runners.

## Inventory and applicability

- **JavaScript/TypeScript:** npm dependencies and dev dependencies, including the
  previously unpinned CI-only `mcp-flightcheck`. The baseline npm audit reported
  14 affected packages (2 critical, 9 high, 3 moderate), including inherited
  dependency effects, from 66 distinct advisories (64 with CVE identifiers).
  An affected package/version does not establish exploitability of this server.
  `src/index.ts` uses `StdioServerTransport`; many HTTP, OAuth, static-serving,
  JSX and proxy findings concern SDK features this entry point does not expose.
  Update the entire installed dependency tree nevertheless.
- **Rust, PHP, Go, Python:** no tracked application sources, manifests or lockfiles
  for these ecosystems. Their ecosystem-wide CVEs are not project findings.
  Actions and hosted runners can contain such tools; this does not make them
  application dependencies or prove the runner environment CVE-free.
- **C++:** the Watcher links against external PixInsight/PCL plus platform system
  libraries. The repository vendors Windows project definitions, not PCL source.
  Local PCL comes from the installed PixInsight SDK; upstream native CI clones
  PCL and keys prebuilt libraries by its commit. There is no pinned application
  binary/SDK version here from which to prove all external native dependencies
  fixed. This fork uses upstream signed Watcher artifacts and deliberately skips
  native build/publish jobs. No native or image-processing code was changed.
- **GitHub:** Dependabot alerts were disabled when queried (HTTP 403), so alert
  absence was not used as evidence. npm audit was queried independently, and
  every baseline advisory was matched to GitHub's `securityAdvisory` identifiers.
  A Dependabot update configuration is added; repository vulnerability-alert
  settings are separate and were not changed.

## Node.js security floor

The [2026-10-21 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
provides Node **22.23.4**, **24.22.1** and **26.12.1**. `engines.node` allows
`^22.23.4 || ^24.22.1 || ^26.12.1`; `.npmrc` makes repository npm installs enforce
that range. `.node-version` selects 24.22.1 (LTS). Unsupported major versions,
including end-of-life 18/20/23/25, are excluded. Update these floors when later
security releases require it. This commit changes project requirements, not the
machine's globally installed Node or an already-running MCP process.

| CVE in the October release | Affected supported lines |
| --- | --- |
| CVE-2026-105482, CVE-2026-106069, CVE-2026-111497 | 22, 24, 26 |
| CVE-2026-105483 | 24, 26 |
| CVE-2026-105481, CVE-2026-106072, CVE-2026-106074, CVE-2026-106073 | 22, 24, 26 |
| CVE-2026-106070, CVE-2026-106071 | 26 |

The runtime security release also updates bundled c-ares, CA certificates,
OpenSSL (22/24), SQLite (22), and Undici. These are not separate npm lockfile
entries; refreshing npm packages alone would not address the runtime floor.

## Dependency remediation

Raise the direct MCP SDK minimum to 1.32.1 and refresh compatible npm dependencies
without `npm audit fix --force`, a direct-dependency major upgrade, or vulnerability
suppression. The SDK permits the Hono adapter 2.x update. Lock `mcp-flightcheck`
0.1.0 as a dev dependency, replacing CI's unversioned `npx -y` download. Invoke
its real CLI file with Node: its 0.1.0 entry-point check compares paths without
resolving symlinks, so the POSIX npm bin symlink exits 0 without running checks.

| Affected package, including inherited effects | Before | After |
| --- | --- | --- |
| `@hono/node-server` | 1.19.9 | 2.1.5 |
| `@modelcontextprotocol/sdk` | 1.26.0 | 1.32.1 |
| `ajv` | 8.17.1 | 8.20.0 |
| `ajv-formats` | 3.0.1 | 3.0.1 |
| `body-parser` | 2.2.2 | 2.3.0 |
| `express` | 5.2.1 | 5.3.0 |
| `express-rate-limit` | 8.2.1 | 8.7.1 |
| `fast-uri` | 3.1.0 | 3.1.9 |
| `hono` | 4.11.9 | 4.13.13 |
| `ip-address` | 10.0.1 | 10.7.4 |
| `path-to-regexp` | 8.3.0 | 8.4.2 |
| `proxy-addr` | 2.0.7 | 2.0.8 |
| `qs` | 6.14.1 | 6.16.1 |
| `router` | 2.2.0 | 2.2.0 |

## Baseline advisory inventory

Identifiers below come from the npm audit and GitHub advisory metadata queried
on 2026-10-22. Rows list advisories directly attached to a package; inherited
impacts on `express`, `router`, and `ajv-formats` are in the version table above.
All directly vulnerable versions are replaced; packages affected only through
transitive dependencies can retain their own version after those dependencies update. Reachability is not claimed for each
advisory; absence of a current npm finding is not a guarantee of no unknown CVEs.

| Package | CVE | Advisory | Severity |
| --- | --- | --- | --- |
| `@hono/node-server` | CVE-2026-29087 | [GHSA-wc8c-qw6v-h7f6](https://github.com/advisories/GHSA-wc8c-qw6v-h7f6) | high |
| `@hono/node-server` | CVE-2026-39406 | [GHSA-92pp-h63x-v22m](https://github.com/advisories/GHSA-92pp-h63x-v22m) | moderate |
| `@hono/node-server` | No CVE assigned in GHSA | [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9) | moderate |
| `@modelcontextprotocol/sdk` | CVE-2026-104850 | [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) | high |
| `@modelcontextprotocol/sdk` | CVE-2026-111767 | [GHSA-22jm-h49p-29qw](https://github.com/advisories/GHSA-22jm-h49p-29qw) | high |
| `@modelcontextprotocol/sdk` | CVE-2026-111769 | [GHSA-6prh-2h8m-c8cw](https://github.com/advisories/GHSA-6prh-2h8m-c8cw) | moderate |
| `@modelcontextprotocol/sdk` | CVE-2026-111768 | [GHSA-46jr-4wx8-v453](https://github.com/advisories/GHSA-46jr-4wx8-v453) | high |
| `@modelcontextprotocol/sdk` | CVE-2026-111771 | [GHSA-rvq5-wwqv-78pq](https://github.com/advisories/GHSA-rvq5-wwqv-78pq) | moderate |
| `ajv` | CVE-2025-69873 | [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) | moderate |
| `body-parser` | CVE-2026-12590 | [GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6) | low |
| `express-rate-limit` | CVE-2026-30827 | [GHSA-46wh-pxpv-q5gq](https://github.com/advisories/GHSA-46wh-pxpv-q5gq) | high |
| `fast-uri` | CVE-2026-16221 | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) | high |
| `fast-uri` | CVE-2026-18446 | [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) | high |
| `fast-uri` | CVE-2026-6321 | [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6) | high |
| `fast-uri` | CVE-2026-6322 | [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc) | high |
| `fast-uri` | CVE-2026-75975 | [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) | high |
| `fast-uri` | CVE-2026-76172 | [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) | high |
| `fast-uri` | CVE-2026-13676 | [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) | high |
| `fast-uri` | CVE-2026-84292 | [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) | high |
| `fast-uri` | CVE-2026-86472 | [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) | moderate |
| `hono` | No CVE assigned in GHSA | [GHSA-gq3j-xvxp-8hrf](https://github.com/advisories/GHSA-gq3j-xvxp-8hrf) | low |
| `hono` | CVE-2026-29086 | [GHSA-5pq2-9x2x-5p6w](https://github.com/advisories/GHSA-5pq2-9x2x-5p6w) | moderate |
| `hono` | CVE-2026-29085 | [GHSA-p6xx-57qc-3wxr](https://github.com/advisories/GHSA-p6xx-57qc-3wxr) | moderate |
| `hono` | CVE-2026-29045 | [GHSA-q5qw-h33p-qvwr](https://github.com/advisories/GHSA-q5qw-h33p-qvwr) | high |
| `hono` | CVE-2026-39410 | [GHSA-r5rp-j6wh-rvv4](https://github.com/advisories/GHSA-r5rp-j6wh-rvv4) | moderate |
| `hono` | CVE-2026-39408 | [GHSA-xf4j-xp2r-rqqx](https://github.com/advisories/GHSA-xf4j-xp2r-rqqx) | moderate |
| `hono` | CVE-2026-39407 | [GHSA-wmmm-f939-6g9c](https://github.com/advisories/GHSA-wmmm-f939-6g9c) | moderate |
| `hono` | CVE-2026-39409 | [GHSA-xpcf-pg52-r92g](https://github.com/advisories/GHSA-xpcf-pg52-r92g) | moderate |
| `hono` | CVE-2026-44458 | [GHSA-qp7p-654g-cw7p](https://github.com/advisories/GHSA-qp7p-654g-cw7p) | moderate |
| `hono` | CVE-2026-44459 | [GHSA-hm8q-7f3q-5f36](https://github.com/advisories/GHSA-hm8q-7f3q-5f36) | low |
| `hono` | CVE-2026-44457 | [GHSA-p77w-8qqv-26rm](https://github.com/advisories/GHSA-p77w-8qqv-26rm) | moderate |
| `hono` | CVE-2026-44456 | [GHSA-9vqf-7f2p-gf9v](https://github.com/advisories/GHSA-9vqf-7f2p-gf9v) | moderate |
| `hono` | CVE-2026-44455 | [GHSA-69xw-7hcm-h432](https://github.com/advisories/GHSA-69xw-7hcm-h432) | moderate |
| `hono` | CVE-2026-47674 | [GHSA-xrhx-7g5j-rcj5](https://github.com/advisories/GHSA-xrhx-7g5j-rcj5) | moderate |
| `hono` | CVE-2026-47675 | [GHSA-3hrh-pfw6-9m5x](https://github.com/advisories/GHSA-3hrh-pfw6-9m5x) | moderate |
| `hono` | CVE-2026-47673 | [GHSA-f577-qrjj-4474](https://github.com/advisories/GHSA-f577-qrjj-4474) | moderate |
| `hono` | CVE-2026-47676 | [GHSA-2gcr-mfcq-wcc3](https://github.com/advisories/GHSA-2gcr-mfcq-wcc3) | moderate |
| `hono` | CVE-2026-56761 | [GHSA-458j-xx4x-4375](https://github.com/advisories/GHSA-458j-xx4x-4375) | moderate |
| `hono` | CVE-2026-54288 | [GHSA-rv63-4mwf-qqc2](https://github.com/advisories/GHSA-rv63-4mwf-qqc2) | moderate |
| `hono` | CVE-2026-54289 | [GHSA-wgpf-jwqj-8h8p](https://github.com/advisories/GHSA-wgpf-jwqj-8h8p) | moderate |
| `hono` | CVE-2026-54290 | [GHSA-88fw-hqm2-52qc](https://github.com/advisories/GHSA-88fw-hqm2-52qc) | high |
| `hono` | CVE-2026-54286 | [GHSA-wwfh-h76j-fc44](https://github.com/advisories/GHSA-wwfh-h76j-fc44) | moderate |
| `hono` | CVE-2026-54287 | [GHSA-j6c9-x7qj-28xf](https://github.com/advisories/GHSA-j6c9-x7qj-28xf) | moderate |
| `hono` | CVE-2026-59897 | [GHSA-xgm2-5f3f-mvvc](https://github.com/advisories/GHSA-xgm2-5f3f-mvvc) | moderate |
| `hono` | CVE-2026-59896 | [GHSA-hvrm-45r6-mjfj](https://github.com/advisories/GHSA-hvrm-45r6-mjfj) | moderate |
| `hono` | CVE-2026-59895 | [GHSA-w62v-xxxg-mg59](https://github.com/advisories/GHSA-w62v-xxxg-mg59) | moderate |
| `hono` | CVE-2026-69207 | [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239) | moderate |
| `hono` | CVE-2026-71850 | [GHSA-f23p-vx2j-j53r](https://github.com/advisories/GHSA-f23p-vx2j-j53r) | moderate |
| `hono` | CVE-2026-71849 | [GHSA-79qm-7rj5-m7r9](https://github.com/advisories/GHSA-79qm-7rj5-m7r9) | low |
| `hono` | CVE-2026-84365 | [GHSA-gqvv-2mrq-wpjv](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv) | moderate |
| `hono` | CVE-2026-84364 | [GHSA-g6gw-c38x-mqfc](https://github.com/advisories/GHSA-g6gw-c38x-mqfc) | moderate |
| `hono` | CVE-2026-84363 | [GHSA-crvj-82cr-hjcx](https://github.com/advisories/GHSA-crvj-82cr-hjcx) | moderate |
| `hono` | CVE-2026-56762 | [GHSA-26pp-8wgv-hjvm](https://github.com/advisories/GHSA-26pp-8wgv-hjvm) | moderate |
| `hono` | CVE-2026-93981 | [GHSA-hxh3-vqpv-xpqv](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv) | moderate |
| `hono` | CVE-2026-56763 | [GHSA-v8w9-8mx6-g223](https://github.com/advisories/GHSA-v8w9-8mx6-g223) | moderate |
| `ip-address` | CVE-2026-42338 | [GHSA-v2v4-37r5-5v8g](https://github.com/advisories/GHSA-v2v4-37r5-5v8g) | moderate |
| `ip-address` | CVE-2026-69192 | [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr) | high |
| `ip-address` | CVE-2026-101913 | [GHSA-rpw4-54j3-4h4q](https://github.com/advisories/GHSA-rpw4-54j3-4h4q) | moderate |
| `ip-address` | CVE-2026-101912 | [GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv) | moderate |
| `ip-address` | CVE-2026-101911 | [GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw) | moderate |
| `path-to-regexp` | CVE-2026-4926 | [GHSA-j3q9-mxjg-w52f](https://github.com/advisories/GHSA-j3q9-mxjg-w52f) | high |
| `path-to-regexp` | CVE-2026-4923 | [GHSA-27v5-c462-wpq7](https://github.com/advisories/GHSA-27v5-c462-wpq7) | moderate |
| `proxy-addr` | CVE-2026-90711 | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) | critical |
| `qs` | CVE-2026-2391 | [GHSA-w7fw-mjwx-w883](https://github.com/advisories/GHSA-w7fw-mjwx-w883) | low |
| `qs` | CVE-2026-8723 | [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) | moderate |
| `qs` | CVE-2026-82417 | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | moderate |

## CI remediation and validation

- Test the three patched minimum runtimes on Linux, macOS and Windows.
- Add a separate `npm run test:security` job (`npm audit --audit-level=low`),
  covering production and development dependencies with no ignored advisories.
- Upgrade checkout/setup-node/artifact actions to current releases and pin all
  external actions by their resolved commit SHA. The action runtime is managed
  by GitHub's hosted runner; `setup-node` selects the application/test runtime.
- Default workflow permissions to `contents: read`; native release/cache jobs
  retain their explicitly needed write permission. PRs no longer publish PCL
  cache assets. Pass the manual PCL ref via an environment variable rather than
  interpolating it into shell source.
- Add weekly npm and GitHub Actions Dependabot update configuration.

Local validation (macOS arm64):

- Official Node archives for 22.23.4 / 24.22.1 / 26.12.1 verified against their
  release SHA-256 manifests and used without replacing the global runtime.
- Clean `npm ci` and `npm run build` on Node 24.22.1.
- `npm test`: 101/101 pass on each of the three runtimes (including TypeScript
  compilation and the handler-drift check).
- Actual MCP flightcheck on Node 24.22.1: 11 pass, 1 warn, 0 fail. The remaining
  warning is malformed JSON-RPC params returning `-32603` rather than `-32602`;
  it is not suppressed and is not claimed fixed by this dependency update.
  The check used an isolated temporary bridge, not the active PixInsight bridge.
- `npm run test:security`: 0 vulnerabilities across prod and dev dependencies.
- `actionlint`, `git diff --check`, handler generation/drift and module-version
  guards passed; no generated module/version changes.
- Repository install with the existing global Node 26.12.0 was rejected with
  `EBADENGINE`, confirming enforcement of the patched runtime requirement.

Cross-platform CI results are available on the pull request. Native module
compile/publish remains skipped by this fork's existing repository guard; it is
not reported as a native build validation.
