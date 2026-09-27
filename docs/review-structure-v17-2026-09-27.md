# Structure V17 – TO power render-core consolidation R3

- Date: 2026-09-27
- Scope: client structure only.
- Existing feature owner remains `maintenance/to-night-power.js` + `functions/api/to-night-power.js`.
- Extracted from `script.js`: only the six-value Morning Meeting power-card render block inside `installEfficiencyMorningMeetingSteamStatusClient`.
- Extracted block SHA256 (LF-normalized): `8bd09c6e384e25e2afaa788a5d8a50c84a45cd51a325ee0293b67b34f7db3400`.
- The pure renderer is prepended to the existing `maintenance/to-night-power.js`; no new browser loader is added and `index.html` is unchanged.
- Existing provider body SHA256 before prefix (LF-normalized): `511dc088f5f7b6a18b8d8e74f1b1e94036251bb762af33a53d9ee1d2bc4dc478`.
- Normal browser rendering prefers the provider core. A compact compatibility fallback preserves the same six fields and same kWh formatter when script.js runs before/without the later provider, including isolated VM tests.
- Not changed: API, authorization, DB/storage, audit history, workbook formulas/writes, Agent, Excel/OIS, CSS, Morning Meeting steam/organic logic.
- Validation gate: baseline-vs-candidate full-suite differential, focused V17 R3 tests, web build, exact changed-path guard, original local repo byte preservation.
