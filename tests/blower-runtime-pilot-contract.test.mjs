import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


const read = relativePath => {
  return readFile(
    new URL(`../${relativePath}`, import.meta.url),
    "utf8"
  );
};


const [queueApi, blowerApi, agent, pageHtml, pageClient] =
  await Promise.all([
    read("functions/api/ois-data-requests.js"),
    read("functions/api/blower-history.js"),
    read("local-tools/ois-agent/ois-login.js"),
    read("maintenance/blower-history.html"),
    read("maintenance/blower-history.js")
  ]);


const ASSET_TAG = "104ETH03AN602";
const SOURCE_TAG = "GSPOGE.ABB_DCS.003ETH03AN602XB04";
const REQUEST_TYPE = "blower_runtime_probe";
const CREATE_ACTION = "create_blower_runtime_probe";
const SYNC_ACTION = "dataparc_runtime_sync";


function balancedBlock(source, openingIndex, openCharacter, closeCharacter) {
  assert.ok(openingIndex >= 0, `opening ${openCharacter} is missing`);

  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }

    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) depth -= 1;

    if (depth === 0) {
      return source.slice(openingIndex, index + 1);
    }
  }

  assert.fail(`unbalanced ${openCharacter}${closeCharacter} block`);
}


function functionSource(source, name) {
  const declaration = new RegExp(
    `(?:async\\s+)?function\\s+${name}\\s*\\(`
  ).exec(source);
  assert.ok(declaration, `${name} function is missing`);

  const start = declaration.index;
  const parametersStart = source.indexOf("(", start);
  const parametersSource = balancedBlock(
    source,
    parametersStart,
    "(",
    ")"
  );
  const bodyStart = source.indexOf(
    "{",
    parametersStart + parametersSource.length
  );
  return source.slice(
    start,
    bodyStart + balancedBlock(source, bodyStart, "{", "}").length
  );
}


function constArrayValues(source, name) {
  const declaration = new RegExp(`const\\s+${name}\\s*=`, "m").exec(source);
  assert.ok(declaration, `${name} declaration is missing`);

  const arrayStart = source.indexOf("[", declaration.index);
  const arraySource = balancedBlock(source, arrayStart, "[", "]");

  const values = [...arraySource.matchAll(/["']([^"']+)["']/g)]
    .map(match => match[1]);

  for (const identifierMatch of arraySource.matchAll(/\b[A-Z][A-Z0-9_]+\b/g)) {
    const identifier = identifierMatch[0];
    const valueDeclaration = new RegExp(
      `const\\s+${identifier}\\s*=\\s*["']([^"']+)["']`,
      "m"
    ).exec(source);

    if (valueDeclaration) values.push(valueDeclaration[1]);
  }

  return values;
}


function sourceCount(source, token) {
  return source.split(token).length - 1;
}


test("freezes the 602 pilot application asset and exact DataPARC source TAG", () => {
  for (const [label, source] of [
    ["queue API", queueApi],
    ["Blower API", blowerApi],
    ["Agent", agent]
  ]) {
    assert.match(source, new RegExp(ASSET_TAG), `${label} must freeze the app asset`);
    assert.match(source, new RegExp(SOURCE_TAG.replaceAll(".", "\\.")), `${label} must freeze the source TAG`);
  }

  assert.ok(
    sourceCount(agent, SOURCE_TAG) >= 1,
    "the exact DataPARC TAG must be present in the Excel bridge"
  );
});


test("registers the read-only probe in the Excel lane and never in the OIS browser lane", () => {
  assert.ok(
    constArrayValues(queueApi, "OIS_REQUEST_TYPES").includes(REQUEST_TYPE),
    "the queue must accept blower_runtime_probe"
  );
  assert.ok(
    constArrayValues(queueApi, "OIS_AGENT_EXCEL_LANE_REQUEST_TYPES").includes(REQUEST_TYPE),
    "the server must offer the probe to the Excel lane"
  );
  assert.ok(
    !constArrayValues(queueApi, "OIS_AGENT_OIS_LANE_REQUEST_TYPES").includes(REQUEST_TYPE),
    "the probe must not consume the OIS browser lane"
  );

  const nextLaneSource = functionSource(agent, "getNextOisAgentLaneRequests");
  assert.match(nextLaneSource, /BLOWER_RUNTIME_PROBE_REQUEST_TYPE/);

  const dispatcherSource = functionSource(agent, "collectOisAgentRequestResult");
  assert.match(
    dispatcherSource,
    /requestType\s*===\s*BLOWER_RUNTIME_PROBE_REQUEST_TYPE/
  );
  assert.match(
    dispatcherSource,
    /collect(?:DataParc)?BlowerRuntime(?:Probe)?(?:Values|Result)?\s*\(/,
    "the Agent dispatcher must call the dedicated Excel collector"
  );
});


test("creates a dedicated probe request and does not trust a client source TAG", () => {
  assert.match(queueApi, new RegExp(`["']${CREATE_ACTION}["']`));

  const createFunctionName = [
    "createBlowerRuntimeProbeRequest",
    "createDataParcBlowerRuntimeProbeRequest"
  ].find(name => queueApi.includes(`function ${name}(`));

  assert.ok(createFunctionName, "a dedicated blower runtime probe creator is missing");

  const createSource = functionSource(queueApi, createFunctionName);
  assert.match(createSource, /BLOWER_RUNTIME_PROBE_ASSET_TAG/);
  assert.match(createSource, /BLOWER_RUNTIME_PROBE_DATAPARC_TAG/);
  assert.doesNotMatch(
    createSource,
    /body\s*\.\s*(?:dataParcTag|dataparcTag|sourceTag|source_tag)/,
    "the queue must derive the source TAG instead of accepting it from the browser"
  );
  assert.match(createSource, /buildBlowerRuntimeProbeChunks\s*\(/);
  assert.match(
    queueApi,
    /const\s+BLOWER_RUNTIME_PROBE_CHUNK_DAYS\s*=\s*31\s*;/
  );
});


test("keeps the DataPARC formula signature and machine-readable bridge markers stable", () => {
  assert.match(agent, /fnValTime\s*\(/);
  assert.ok(
    agent.includes('1,"=",,"H",200,TRUE'),
    'fnValTime must use the field-approved 1,"=",,"H",200,TRUE argument contract'
  );
  assert.ok(
    agent.includes('1,"=",,"H")'),
    'each chunk must also use the field-approved 1,"=",,"H" scalar sentinel'
  );
  assert.match(
    agent,
    /\$intervalCount\s+-ge\s+200/,
    "a full 200-row interval block must fail closed as possible truncation"
  );
  assert.match(agent, /fnAtTimeArray\s*\(/);

  assert.match(
    agent,
    /__(?:DATAPARC_)?BLOWER_RUNTIME_(?:PILOT_|PROBE_)?STAGE__/
  );
  assert.match(
    agent,
    /__(?:DATAPARC_)?BLOWER_RUNTIME_(?:PILOT_|PROBE_)?RESULT__/
  );
  assert.match(agent, /ConvertTo-Json\s+-Compress/);
});


test("the probe result path is read-only and accepts a valid zero-runtime result", () => {
  const completionSource = functionSource(queueApi, "completeAgentRequest");

  assert.match(completionSource, /BLOWER_RUNTIME_PROBE_REQUEST_TYPE/);
  assert.match(completionSource, /normalizeBlowerRuntimeProbeResult\s*\(/);

  const probeBranchStart = completionSource.indexOf(
    "BLOWER_RUNTIME_PROBE_REQUEST_TYPE"
  );
  const probeBranch = completionSource.slice(
    Math.max(0, probeBranchStart - 500),
    probeBranchStart + 5000
  );

  assert.doesNotMatch(probeBranch, /UPDATE\s+blower_history_assets/i);
  assert.doesNotMatch(probeBranch, /INSERT\s+INTO\s+blower_history_events/i);
});


test("validates binary end state, bounded runtime, and the exact queued identity", () => {
  const validatorName = [
    "normalizeDataParcRuntimeProbeResult",
    "normalizeBlowerRuntimeProbeResult",
    "validateBlowerRuntimeProbeResult"
  ].find(name =>
    queueApi.includes(`function ${name}(`) ||
    blowerApi.includes(`function ${name}(`) ||
    agent.includes(`function ${name}(`)
  );

  assert.ok(validatorName, "a named probe-result validator is missing");

  const source = [queueApi, blowerApi, agent]
    .find(candidate => candidate.includes(`function ${validatorName}(`));
  const validatorSource = functionSource(source, validatorName);

  assert.match(
    validatorSource,
    /(?:BLOWER_RUNTIME_PROBE_ASSET_TAG|DATAPARC_RUNTIME_SYNC_ASSET_TAG)/
  );
  assert.match(
    validatorSource,
    /(?:BLOWER_RUNTIME_PROBE_DATAPARC_TAG|DATAPARC_RUNTIME_SYNC_SOURCE_TAG)/
  );
  assert.match(validatorSource, /run(?:ning)?Seconds/i);
  assert.match(validatorSource, /range|window|startAt|windowStart/i);
  assert.match(validatorSource, /(?:normalize|is).*Runtime.*State\s*\(/i);
  assert.match(validatorSource, /throw|error|reason|return\s+null/i);
});


test("ships the browser query-poll-sync contract without legacy split writes", () => {
  const combinedFrontend = `${pageHtml}\n${pageClient}`;

  assert.match(combinedFrontend, new RegExp(ASSET_TAG));
  assert.match(
    combinedFrontend,
    /data-asset-action=["']dataparc_runtime_probe["']/
  );
  assert.match(combinedFrontend, new RegExp(CREATE_ACTION));
  assert.match(combinedFrontend, /status_batch/);
  assert.match(combinedFrontend, new RegExp(SYNC_ACTION));

  const syncFunctionName = [
    "syncDataParcBlowerRuntime",
    "syncDataparcRuntime",
    "applyDataParcRuntimeSync",
    "saveDataParcBlowerRuntime"
  ].find(name => pageClient.includes(`function ${name}(`));

  assert.ok(syncFunctionName, "the frontend one-shot sync helper is missing");
  const syncSource = functionSource(pageClient, syncFunctionName);

  assert.match(
    pageClient,
    /dataparc_runtime_probe[\s\S]{0,500}syncDataParcBlowerRuntime\s*\(/
  );

  assert.match(syncSource, new RegExp(`["']${SYNC_ACTION}["']`));
  assert.match(syncSource, /requestId/);
  assert.doesNotMatch(syncSource, /runtimeHours\s*:/);
  assert.doesNotMatch(syncSource, /isRunning\s*:/);
  assert.doesNotMatch(syncSource, /action\s*:\s*["']runtime(?:_state)?["']/);
});


test("the server sync uses trusted probe data, CAS, idempotent provenance, and an atomic batch", () => {
  assert.match(blowerApi, new RegExp(`["']${SYNC_ACTION}["']`));

  const syncFunctionName = [
    "applyDataParcRuntimeSync",
    "syncDataParcBlowerRuntime"
  ].find(name => blowerApi.includes(`function ${name}(`));

  assert.ok(syncFunctionName, "the atomic DataPARC runtime sync helper is missing");
  const syncSource = functionSource(blowerApi, syncFunctionName);

  assert.match(syncSource, /ois_data_requests/);
  assert.match(syncSource, /DATAPARC_RUNTIME_PROBE_REQUEST_TYPE/);
  assert.match(syncSource, /normalizeDataParcRuntimeProbeResult\s*\(/);
  assert.match(syncSource, /status\s*=\s*['"]complete['"]|status[\s\S]{0,80}complete/i);
  assert.match(syncSource, /DATAPARC_RUNTIME_SYNC_ASSET_TAG/);
  assert.match(syncSource, /cycle_start_revision/i);
  assert.match(syncSource, /cycle_runtime_revision/i);
  assert.match(syncSource, /last_replacement_at/i);
  assert.match(syncSource, /DATAPARC_RUNTIME_SYNC_SOURCE_TYPE/);
  assert.match(syncSource, /source_log_id/i);
  assert.match(syncSource, /database\s*\.\s*batch\s*\(/);

  assert.doesNotMatch(syncSource, /body\s*\.\s*(?:runtimeHours|isRunning|sourceTag|dataParcTag)/);
  assert.doesNotMatch(syncSource, /UPDATE\s+blower_history_events/i);
  assert.doesNotMatch(syncSource, /DELETE\s+FROM\s+blower_history_events/i);
});
