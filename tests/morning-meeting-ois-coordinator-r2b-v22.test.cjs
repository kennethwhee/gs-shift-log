"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root =
  path.resolve(
    __dirname,
    ".."
  );

const script =
  fs.readFileSync(
    path.join(
      root,
      "script.js"
    ),
    "utf8"
  );

const coordinator =
  fs.readFileSync(
    path.join(
      root,
      "maintenance",
      "morning-meeting-query-sources.js"
    ),
    "utf8"
  );


test(
  "R2A logging is optional-safe",
  () => {

    assert.match(
      script,
      /console\.info\?\.\(/
    );
  }
);


test(
  "Power and Closed start before operating await",
  () => {

    const marker =
      coordinator.indexOf(
        "MORNING_MEETING_EARLY_NON_OIS_V1_R2B_V22"
      );

    const operating =
      coordinator.indexOf(
        "const result = await loader({",
        marker
      );

    assert.ok(
      marker >= 0
    );

    assert.ok(
      operating > marker
    );

    const early =
      coordinator.slice(
        marker,
        operating
      );

    assert.match(
      early,
      /toNightPower/
    );

    assert.match(
      early,
      /morningMeetingClosedCofiring/
    );
  }
);


test(
  "Steam OIS starts after operating lookup",
  () => {

    const operating =
      coordinator.indexOf(
        "const result = await loader({"
      );

    const steam =
      coordinator.indexOf(
        "loadEfficiencyMorningMeetingSteamOis",
        operating
      );

    assert.ok(
      operating >= 0
    );

    assert.ok(
      steam > operating
    );
  }
);


test(
  "operations bulk itself contains no Steam loader",
  () => {

    const start =
      script.indexOf(
        "function createBulkLookupItems()"
      );

    const end =
      script.indexOf(
        "async function runBulkLookupItem",
        start
      );

    assert.ok(
      start >= 0 &&
      end > start
    );

    const bulk =
      script.slice(
        start,
        end
      );

    assert.doesNotMatch(
      bulk,
      /loadEfficiencyMorningMeetingSteamOis/
    );

    assert.doesNotMatch(
      bulk,
      /loadEfficiencyMorningMeetingSteamStatus/
    );

    assert.doesNotMatch(
      bulk,
      /daily-data/
    );
  }
);
