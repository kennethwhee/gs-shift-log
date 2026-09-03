import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || process.cwd());

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n");
}

function between(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `${startToken} marker is missing`);
  assert.notEqual(end, -1, `${endToken} marker is missing`);
  return source.slice(start, end + endToken.length);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} function is missing`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;

  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  assert.fail(`${name} function body is not balanced`);
}

const css = read("maintenance/blower-history.css");
const html = read("maintenance/blower-history.html");
const client = read("maintenance/blower-history.js");
const api = read("functions/api/blower-history.js");
const compactCss = between(
  css,
  "MOBILE_BLOWER_COMPACT_GRID_V1",
  "/* MOBILE_BLOWER_COMPACT_GRID_V1 */"
);

test("mobile Blower grids use three and two compact columns", () => {
  assert.match(
    compactCss,
    /\.asset-grid\.is-unit-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    "FBHE and Seal Pot unit rows must use three columns"
  );
  assert.match(
    compactCss,
    /\.asset-grid\.is-unified-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    "other standard Blower rows must use two columns"
  );
  assert.match(
    compactCss,
    /\.asset-grid\.is-unified-grid \.asset-unit-row\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    "each non-FBHE unit must keep its own two-card row"
  );
  assert.match(compactCss, /max-width:\s*700px/);
  assert.match(compactCss, /pointer:\s*coarse/);
});

test("compact cards retain key status while moving verbose content to history", () => {
  assert.match(compactCss, /\.cycle-primary-metric[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  assert.match(compactCss, /\.asset-evidence[\s\S]*?display:\s*none/);
  assert.match(compactCss, /span:not\(:first-of-type\)[\s\S]*?display:\s*none/);
  assert.match(compactCss, /\.asset-action[\s\S]*?min-height:\s*32px/);
  assert.match(compactCss, /\.placeholder-note[\s\S]*?display:\s*none/);
  assert.match(client, /data-mobile-position="\$\{escapeHtml\(String\(asset\.positionLabel/);
  assert.match(client, /data-mobile-label="\$\{escapeHtml\(cyclePrimaryMobileLabel\)\}"/);
  assert.match(client, /data-mobile-value="\$\{escapeHtml\(cyclePrimaryMobileValue\)\}"/);
  assert.match(compactCss, /content:\s*attr\(data-mobile-label\)/);
  assert.match(compactCss, /content:\s*attr\(data-mobile-value\)/);
  assert.doesNotMatch(compactCss, /overflow:\s*visible/);
  assert.match(client, /data-asset-action="history"/);
});

test("type grouping preserves a separate row for every unit", () => {
  assert.match(
    client,
    /function usesUnitRows\(blowerType\)\s*\{\s*return \["fbhe", "seal_pot"\]\.includes/,
    "only the two three-card types should use the three-column unit grid"
  );
  assert.match(client, /const standardEntries = \[\.\.\.visibleStandardAssets, \.\.\.visibleStandardSlots\]\.sort\(compareAssetDisplayEntries\)/);
  assert.match(client, /unitDisplayRank\(leftItem\.unitNo\) - unitDisplayRank\(rightItem\.unitNo\)/);
  assert.match(client, /positionDisplayRank\(leftItem\.positionLabel\) - positionDisplayRank\(rightItem\.positionLabel\)/);
  assert.match(client, /<div class="asset-unit-row" data-unit-row="\$\{escapeHtml\(unitNo\)\}">/);
  assert.match(client, /unitEntries\.map\(entry => renderDisplayEntry\(entry, setting\)\)\.join\(""\)/);

  const context = vm.createContext({
    state: { activeType: "organic_fuel" },
    escapeHtml: value => String(value ?? ""),
    renderDisplayEntry: entry => `<article data-unit="${entry.item.unitNo}" data-position="${entry.item.positionLabel}"></article>`
  });
  const helpers = [
    "unitDisplayRank",
    "positionDisplayRank",
    "compareAssetDisplayEntries",
    "unifiedGroupLabel",
    "usesUnitRows",
    "unitRowLabel",
    "buildAssetSectionsHtml"
  ].map(name => extractFunction(client, name)).join("\n");
  vm.runInContext(`${helpers}\nthis.buildAssetSectionsHtml = buildAssetSectionsHtml;`, context);

  const rendered = context.buildAssetSectionsHtml([
    { blowerType: "organic_fuel", unitNo: "2", positionLabel: "#B", sortOrder: 452 },
    { blowerType: "organic_fuel", unitNo: "1", positionLabel: "#A", sortOrder: 401 },
    { blowerType: "organic_fuel", unitNo: "2", positionLabel: "#A", sortOrder: 451 }
  ], [], {}, "all");
  const unitOne = rendered.match(/data-unit-row="1">([\s\S]*?)<\/div>/)?.[1] || "";
  const unitTwo = rendered.match(/data-unit-row="2">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.match(unitOne, /data-unit="1" data-position="#A"/);
  assert.doesNotMatch(unitOne, /data-unit="2"/);
  assert.match(unitTwo, /data-unit="2" data-position="#A"[\s\S]*data-unit="2" data-position="#B"/);
});

test("server inventory matches three-per-unit and two-per-unit contracts", () => {
  assert.match(api, /key:\s*"fbhe"[\s\S]*?expected:\s*\{\s*"1":\s*3,\s*"2":\s*3\s*\}/);
  assert.match(api, /key:\s*"seal_pot"[\s\S]*?expected:\s*\{\s*"1":\s*3,\s*"2":\s*3\s*\}/);
  assert.match(api, /key:\s*"organic_fuel"[\s\S]*?expected:\s*\{\s*"1":\s*2,\s*"2":\s*2\s*\}/);
  assert.match(api, /key:\s*"flyash_bag"[\s\S]*?expected:\s*\{\s*"1":\s*2,\s*"2":\s*2\s*\}/);
  assert.match(api, /key:\s*"flyash_silo"[\s\S]*?expected:\s*\{\s*shared:\s*2\s*\}/);
});

test("desktop layout remains unchanged and mobile assets are cache-busted", () => {
  const preCompactCss = css.slice(0, css.indexOf("MOBILE_BLOWER_COMPACT_GRID_V1"));
  assert.match(
    preCompactCss,
    /\.asset-grid\.is-unified-grid,\s*\n\.asset-grid\.is-pending-grid\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    "desktop four-card grid must remain intact"
  );
  assert.match(html, /blower-history\.css\?v=20260903-dataparc-runtime-pilot-v1/);
  assert.match(html, /blower-history\.js\?v=20260903-dataparc-runtime-pilot-v1/);
});
