# Pantheon branch audit, 2026-11-02

Based on `integration/pantheon-deified-all` at `dde1c0fe17e513cd45e9384ee501712a08c7d61b`.
The user's restriction is to leave everything made by Sachin untouched. The existing
files changed here were created and modified only by Pantheon_Deified according to
the repository's available history. All other changes are new files.

## Fixed

- Continuous vital readings: adjacent one-second samples previously never satisfied
  the ten-second separation check. Evaluate the latest state per metric over a
  ten-second span, including intervening samples. Recovery uses the same rule.
  Delayed/replayed older batches and future samples cannot reopen old alerts.
- Web thermometer: decode Bluetooth IEEE-11073 decimal FLOAT, rather than IEEE-754
  float32. Ignore unavailable and truncated packets. Truncated heart-rate packets
  also no longer throw DataView bounds errors.
- Transport: use the server's upcoming appointment list instead of filtering
  hospital wall times against the browser's timezone. Preserve naive hospital pickup
  times when editing the coordination form.
- Trip sharing: starting a watcher no longer immediately refreshes and unmounts its
  card, which previously cleared the watcher after the first position.
- Patient switching: remount the wearable and transport workspaces per patient so
  device state, pending samples, consent, setup tokens and transport forms are not
  inherited by the next selected patient.
- Wearable range selection now requests the chosen range, rather than always
  requesting 365 days. Retain compatible min/max/count rendering when the server
  returns aggregated points.

## Confirmed issues left unchanged by the ownership restriction

- `backend/requirements.txt` pins pypdf 6.21.2. The last audit branch CI reported
  seven vulnerabilities, with fixes in 6.21.3/6.21.4. A locally tested 6.21.4
  manifest passed pip-audit, but this branch does not change Sachin's manifest.
  The original CI dependency-audit step may therefore continue to fail.
- `backend/app/main.py` omits PUT from CORS methods although companion-sharing
  uses PUT, preventing that operation from separately hosted allowed origins.
- `backend/app/services/jobs.py` can compare aware reminder timestamps with naive
  hospital times and crash the reminder job. Its older activity day window also
  needs the hospital-to-UTC correction from the later audit line.
- `frontend/src/care/PatientTools.jsx` schedules dose sounds against the device
  clock, while medication status comes from the hospital day.
- `backend/app/routers/round2.py` contains the capped dense-history query and
  cancelled-day-pass issue addressed on the later audit branch. That later branch
  has not been merged here because it also changes Sachin-created files. Its
  aggregation integer cast also needs explicit floor for consistent PostgreSQL
  and SQLite bucket boundaries.

These findings are not fixed by suppressing security checks or by modifying
teammate-owned workflows. They require a separately authorized change to the shared
files. No deployment, merge into deploy/main, branch deletion or PR retargeting is
part of this audit. Real Android/watch validation remains outstanding.
