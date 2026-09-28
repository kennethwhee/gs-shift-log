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

const reset =
  fs.readFileSync(
    path.join(
      root,
      "maintenance",
      "morning-meeting-reset-requery-overlay-v1.js"
    ),
    "utf8"
  );

test(
  "normal bulk preserves options and serializes OIS",
  () => {

    assert.match(
      script,
      /MORNING_MEETING_OIS_SERIAL_LANE_V1_R2A_V23/
    );

    assert.match(
      script,
      /createBulkLookupItems\(\s*options\s*\)/
    );

    assert.match(
      script,
      /runMorningMeetingOisSerialLaneV23/
    );

    assert.doesNotMatch(
      script,
      /const\s+lookupPromises\s*=\s*createBulkLookupItems/
    );
  }
);

test(
  "Water can reuse completed values",
  () => {

    assert.doesNotMatch(
      script,
      /key\s*:\s*"water"\s*,\s*alwaysLoad\s*:\s*true/
    );
  }
);

test(
  "reset path serializes shared OIS work",
  () => {

    assert.match(
      reset,
      /MORNING_MEETING_RESET_OIS_SERIAL_LANE_V1_R2A_V23/
    );

    assert.match(
      reset,
      /runFreshOperationsOisSerialLaneV23/
    );

    assert.doesNotMatch(
      reset,
      /const\s+operationPromise\s*=\s*Promise\.allSettled\(\s*items\.map/
    );
  }
);

test(
  "serial lane excludes SMP and Weather",
  () => {

    const start =
      script.indexOf(
        "async function runMorningMeetingOisSerialLaneV23"
      );

    const end =
      script.indexOf(
        "function runBulkLookup",
        start
      );

    assert.ok(
      start >= 0 &&
      end > start
    );

    const code =
      script.slice(
        start,
        end
      );

    for (
      const key
      of [
        "water",
        "limestone",
        "gear-pinion",
        "silo-level",
        "daily-data"
      ]
    ) {

      assert.ok(
        code.includes(
          JSON.stringify(key)
        )
      );
    }

    assert.equal(
      code.includes(
        '"smp-price"'
      ),
      false
    );

    assert.equal(
      code.includes(
        '"weather"'
      ),
      false
    );
  }
);
