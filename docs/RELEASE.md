# Consolidated release

Release branch: `codex/final-deliverable`. Baseline: integrated teammate branch at `703c28c`, with the corrupted frontend files recovered from `37b3242`.

## Changes

- Standard backend startup now includes Memory Up and patient appointment slots. Compatibility entry points remain available.
- Fixed strict response validation for clinician briefs and AI report explanations.
- Recovered truncated navigation/styles and fixed a missing wearable chart import.
- Kept bounded longitudinal sensor history with bucket min/max and raw sample counts. Daily activity alerts use hospital-local day boundaries. Cancelled appointments are excluded from the day pass.
- Medicine reminder times come from absolute server timestamps so changing the phone timezone does not move the dose time.
- Encrypted uploads, bulk intake sources and appointment attachments persist in the database with their owning records. Local cache loss no longer makes a newly saved upload disappear.
- Included appointment advice assets in each independent web app, corrected portal route selection, and removed unconfigured provider setup details from ordinary users' settings.
- Consolidated backend dependencies and CI. The small bundled guideline library uses explicit site/stage matching without loading a downloaded embedding model on the free backend. The optional Chroma implementation remains in source for larger libraries.

## Preservation and rollout

Before rollout, the original live metadata inventory contained 62 documents, all matching bundled fixtures; no additional uploaded document was found. No live record content was downloaded. Existing PostgreSQL records and encryption keys must be retained. Schema changes are additive tables; no live database reset is part of this release.

Do not delete the original deploy history until post-release verification is complete. Back up the repository refs before pruning historical branches. The UI redesign remains a later task.

## Remaining provider/device checks

Automatic Google Calendar invitations need OAuth credentials and a controlled real invitation test. SMS, WhatsApp, telephony and hosted speech need configured adapters and delivery tests. Native Android BLE requires an actual device/sensor test. Browser checks cover modern Chromium and responsive widths; physical iPhone/Safari and foldable hardware have not been verified.

Validation results and deployed commit are recorded below after the release checks finish.

## Local validation

- 223 backend tests passed before the final added site-normalization regression; one OCR test skipped because the local Windows host lacks Tesseract. Linux CI installs Tesseract and runs that test.
- Backend and frontend dependency audits reported no known vulnerabilities.
- Transport and Memory Up component browser regressions passed.
- Portal browser journeys check every accessible navigation screen for uncaught errors and API server errors, with layouts exercised at 320, 390, 540, 768, 1024 and 1440 pixel widths.

## Branch reconciliation

The integrated release supersedes the partial direct-to-main AI changes. Its stricter schemas, role-aware conversation generation, source validation and hospital time helpers are retained and repaired here. The older Copilot branch's broken imports are not copied. The omitted consistency-audit fixes for dense history, cancelled visits and the hospital-local activity day are applied with regressions; hospital-local seeding already exists in the integrated baseline. Old branch tips remain recoverable in Git history and a local Git bundle.

The final added normalization regression also passes locally. The final release requires all three CI jobs to pass at its exact commit. Historical deployment variants are archived under `deploy/legacy`; they do not change or delete their old external services.

## Verified release results

GitHub Actions run 42218211974 passed all jobs: 225 API tests on SQLite, 225 on PostgreSQL, all three portal browser journeys, sensor packet tests, transport/advice component regressions, all app builds and both dependency audits. Run 42218517025 and 42218517057 also passed after main and the deployment branch advanced.

Rollout is pending restored Render access. Public checks still reported the previous 2.0.0 backend after the push. Do not treat a branch push as a completed deployment. Preserve the rollback tags under `archive/pre-final-*-2026-11-06`. The source now uses automatic text detection to avoid marking historical CRLF files as user edits when checking out on Windows.
