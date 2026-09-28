import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url
      )
    ),
    '..'
  );

const script =
  fs.readFileSync(
    path.join(
      root,
      'script.js'
    ),
    'utf8'
  );

const coordinator =
  fs.readFileSync(
    path.join(
      root,
      'maintenance',
      'morning-meeting-query-sources.js'
    ),
    'utf8'
  );


function section(
  source,
  startToken,
  endToken
) {
  const start =
    source.indexOf(
      startToken
    );

  const end =
    source.indexOf(
      endToken,
      start +
        startToken.length
    );

  assert.ok(
    start >= 0,
    'start boundary missing: ' +
      startToken
  );

  assert.ok(
    end > start,
    'end boundary missing: ' +
      endToken
  );

  return source.slice(
    start,
    end
  );
}


test(
  'Morning Meeting operations bulk does not read Daily DATA Excel',
  () => {

    const bulk =
      section(
        script,
        'function createBulkLookupItems()',
        'async function runBulkLookupItem'
      );

    assert.doesNotMatch(
      bulk,
      /loadEfficiencyMorningMeetingDailyData/
    );

    assert.doesNotMatch(
      bulk,
      /daily_data_excel/
    );

    assert.doesNotMatch(
      bulk,
      /showOpenFilePicker|showDirectoryPicker/
    );

    /*
     * Verify the actual current source routes.
     *
     * Weather intentionally uses loadWeatherForBulk(),
     * which then owns the Weather-specific loading policy.
     */
    assert.match(
      bulk,
      /key:\s*[\r\n\s]*"weather"/
    );

    assert.match(
      bulk,
      /loadWeatherForBulk/
    );

    assert.match(
      bulk,
      /key:\s*[\r\n\s]*"smp-price"/
    );

    assert.match(
      bulk,
      /loadEfficiencyMorningMeetingSmpPrice/
    );
  }
);


test(
  'whole-data coordinator uses current sources instead of Daily DATA Excel',
  () => {

    const query =
      section(
        coordinator,
        'async function query(source, options = {})',
        'function scheduleRender()'
      );

    assert.doesNotMatch(
      query,
      /loadEfficiencyMorningMeetingDailyData/
    );

    assert.doesNotMatch(
      query,
      /daily_data_excel/
    );

    assert.match(
      query,
      /toNightPower/
    );

    assert.match(
      query,
      /loadEfficiencyMorningMeetingSteamOis/
    );

    assert.match(
      query,
      /morningMeetingClosedCofiring/
    );
  }
);
