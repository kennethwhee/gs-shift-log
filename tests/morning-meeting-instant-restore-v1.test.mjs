import fs from "node:fs";
import assert from "node:assert/strict";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("maintenance/morning-meeting-instant-restore-v1.js");
const index = read("index.html");

assert.match(source, /MORNING_MEETING_INSTANT_RESTORE_V1/);
assert.match(source, /gsShiftLog\.morningMeetingDisplaySnapshot\.v1/);
assert.match(source, /MutationObserver/);
assert.match(source, /morningMeetingSelectedDateResetStateChanged/);
assert.match(source, /morningMeetingResetStateChanged/);
assert.match(source, /isMorningMeetingSelectedDateResetActive/);
assert.match(source, /localStorage/);
assert.match(source, /guardUntil/);
assert.match(source, /is-mm-instant-restore-cold/);
assert.match(source, /저장된 값을 불러오는 중/);

// Display acceleration only: this module must not own business-data transport.
assert.doesNotMatch(source, /\/api\//);
assert.doesNotMatch(source, /\bfetch\s*\(/);
assert.doesNotMatch(source, /XMLHttpRequest/);

const loader = /<script\s+src="\/maintenance\/morning-meeting-instant-restore-v1\.js\?v=20261009-power-date-sync-v1"\s+defer\s*><\/script>/;
assert.match(index, loader);

const instantIndex = index.lastIndexOf("morning-meeting-instant-restore-v1.js?v=20261009-power-date-sync-v1");
const legacyIndex = index.lastIndexOf("morning-meeting-legacy-saved-fallback-v1.js");
const powerIndex = index.lastIndexOf("maintenance/to-night-power.js");
assert.ok(instantIndex > legacyIndex, "instant restore loader must run after legacy saved fallback");
assert.ok(instantIndex > powerIndex, "instant restore loader must run after TO power provider");

console.log("PASS: Morning Meeting instant display restore v1 contract");
