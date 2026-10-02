import fs from "node:fs";
import assert from "node:assert/strict";

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const api = read("functions/api/morning-meeting-purge.js");
const client = read("maintenance/morning-meeting-permanent-purge-v1.js");
const query = read("maintenance/morning-meeting-query-sources.js");
const index = read("index.html");

assert.match(api, /selected_date_data_delete_v4/);
assert.match(api, /INSERT INTO morning_meeting_auto_history_overrides/);
assert.match(api, /ON CONFLICT\(target_date\) DO UPDATE SET/);
assert.match(api, /reset_active = 1/);
assert.match(api, /values_json = '\{\}'/);
assert.match(api, /reset_snapshot_values_json = '\{\}'/);
assert.match(api, /resetActive: true/);

const purgeTypeBlock = api.match(/const PURGE_REQUEST_TYPES = Object\.freeze\(\[([\s\S]*?)\]\);/);
assert.ok(purgeTypeBlock, "purge request type contract missing");
assert.doesNotMatch(purgeTypeBlock[1], /cofiring_daily|cofiring_period|to_night|power_input|solid_fuel|unloading/i);

assert.match(client, /자료삭제/);
assert.match(client, /TO 전력 입력 및 혼소율 계산 원본은 삭제되지 않습니다/);
assert.match(client, /confirmText: "삭제"/);
assert.match(client, /cancelText: "취소"/);
assert.match(client, /\[전체조회\].*\[재조회\]/s);
assert.match(client, /mode: "selected_date_data_delete_v4"/);

const requeryStart = query.indexOf("async function requeryAll");
const requeryEnd = query.indexOf("async function query", requeryStart);
const requerySegment = query.slice(requeryStart, requeryEnd);
assert.ok(requerySegment.length > 0, "requeryAll segment missing");
assert.doesNotMatch(requerySegment, /RESET_ACTIONS\.restore/);
assert.doesNotMatch(requerySegment, /restoreMorningMeetingSavedCompletedHistoryForDate/);
assert.match(requerySegment, /return await query\(/);
assert.match(query, /powerSucceeded/);
assert.match(query, /closedSucceeded/);
assert.match(query, /operationsSucceeded && steamSucceeded && powerSucceeded && closedSucceeded/);
assert.match(query, /자료삭제된 날짜는 전체조회 또는 재조회를 사용해 주세요/);

assert.match(index, /morning-meeting-query-sources\.js[^"]*dataDelete=20261002-v4/);
assert.match(index, /morning-meeting-permanent-purge-v1\.js[^"]*dataDelete=20261002-v4/);

console.log("PASS: selected-date Morning Meeting data delete contract v4");
