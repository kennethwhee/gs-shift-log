'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const provider = require(path.join(repo, 'maintenance', 'morning-meeting-closed-cofiring.js'));

function compactFixture() {
  const date = '2026-09-23';
  const unit1 = {
    coal: {quantity: 557.51},
    bio: {quantity: 420.81},
    organic: {quantity: 83.11},
    manure: {quantity: 0},
    heats: {coal: 3271, bio: 1362},
    ratios: {organic: 5.41, total: 32.73},
    fuelRatios: {organicGroup: 5.41, total: 32.73}
  };
  const unit2 = {
    coal: {quantity: 586.88},
    bio: {quantity: 381.29},
    organic: {quantity: 83.11},
    manure: {quantity: 0},
    heats: {coal: 3443, bio: 1234},
    ratios: {organic: 5.36, total: 29.88},
    fuelRatios: {organicGroup: 5.36, total: 29.88}
  };
  const combined = {
    heats: {
      coal: unit1.heats.coal + unit2.heats.coal,
      bio: unit1.heats.bio + unit2.heats.bio
    },
    ratios: {organic: 5.385, total: 31.305},
    fuelRatios: {organicGroup: 5.385, total: 31.305}
  };
  const bio = u => u.heats.bio / (u.heats.coal + u.heats.bio) * 100;
  return {
    date,
    expected: {
      unit1Bio: bio(unit1),
      unit2Bio: bio(unit2),
      combinedBio: combined.heats.bio / (combined.heats.coal + combined.heats.bio) * 100
    },
    item: {
      targetDate: date,
      revision: 1,
      sourceRequestId: 'e54897bc-4caa-4d96-9577-359c3652827c',
      updatedAt: '2026-09-24T00:10:00.000Z',
      summary: {
        unit1: {
          coal: 557.51, bio: 420.81, organic: 83.11, manure: 0,
          bioRatio: bio(unit1), totalRatio: 32.73
        },
        unit2: {
          coal: 586.88, bio: 381.29, organic: 83.11, manure: 0,
          bioRatio: bio(unit2), totalRatio: 29.88
        },
        combined: {totalRatio: 31.305}
      },
      snapshot: {
        schemaVersion: 1,
        targetDate: date,
        sourceRequestId: 'e54897bc-4caa-4d96-9577-359c3652827c',
        period: {startLocal: date + 'T00:00', endLocal: '2026-09-24T00:00'},
        manual: {receipts: {organic: 166.26}},
        organicUsage: {endTotal: 83.66},
        result: {units: {unit1, unit2}, combined}
      }
    }
  };
}

test('current compact closing is accepted using already-saved snapshot ratios', () => {
  const f = compactFixture();
  const out = provider.normalizeItem(f.item, f.date);
  assert.ok(out);
  assert.equal(out.targetDate, f.date);
  assert.equal(out.unitOne.coal, 557.51);
  assert.equal(out.unitTwo.bio, 381.29);
  assert.equal(out.unitOne.organicRatio, 5.41);
  assert.equal(out.unitTwo.organicRatio, 5.36);
  assert.equal(out.unitOne.bioRatio, f.expected.unit1Bio);
  assert.equal(out.unitTwo.bioRatio, f.expected.unit2Bio);
  assert.equal(out.combined.bioRatio, f.expected.combinedBio);
  assert.equal(out.combined.organicRatio, 5.385);
  assert.equal(out.combined.totalRatio, 31.305);
  assert.equal(out.organic.sludgeTotal, 166.26);
  assert.equal(out.organic.organicSiloTotal, 83.66);
});

test('existing summary fields stay authoritative over snapshot fallbacks', () => {
  const f = compactFixture();
  f.item.summary.unit1.organicGroupRatio = 4.11;
  f.item.summary.unit2.organicGroupRatio = 4.22;
  f.item.summary.combined.bioRatio = 19.1;
  f.item.summary.combined.organicGroupRatio = 4.165;
  f.item.summary.combined.totalRatio = 23.265;
  const out = provider.normalizeItem(f.item, f.date);
  assert.equal(out.unitOne.organicRatio, 4.11);
  assert.equal(out.unitTwo.organicRatio, 4.22);
  assert.equal(out.combined.bioRatio, 19.1);
  assert.equal(out.combined.organicRatio, 4.165);
  assert.equal(out.combined.totalRatio, 23.265);
});

test('provider and V4 cache key ship together', () => {
  const js = fs.readFileSync(
    path.join(repo, 'maintenance', 'morning-meeting-closed-cofiring.js'),
    'utf8'
  );
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert.match(js, /MORNING_MEETING_CLOSED_SUMMARY_COMPAT_V4/);
  assert.match(
    html,
    /morning-meeting-closed-cofiring\.js\?[^"]*summaryCompat=20260928-v4/
  );
});
