const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');

function read(rel){
  return fs.readFileSync(
    path.join(root,rel),
    'utf8'
  );
}

const ui=read(
  'maintenance/cofiring-period-ui-v5.js'
);

const html=read(
  'index.html'
);

test('Morning Meeting and Daily DATA no longer auto-fill cofiring organic usage',()=>{
  assert.match(
    ui,
    /COFIRING_ORGANIC_SOURCE_DECOUPLE_V1/
  );

  assert.match(
    ui,
    /COFIRING_EXTERNAL_ORGANIC_AUTOFILL_ENABLED=false/
  );

  assert.match(
    ui,
    /function applyMorningMeetingOrganicDraft\(\{recalculate=true\}=\{\}\)\{if\(!COFIRING_EXTERNAL_ORGANIC_AUTOFILL_ENABLED\)return false;/
  );

  assert.match(
    ui,
    /function bindMorningMeetingOrganicObserver\(\)\{if\(!COFIRING_EXTERNAL_ORGANIC_AUTOFILL_ENABLED\)return;/
  );

  assert.doesNotMatch(
    html,
    /cofiring-organic-excel-auto-v1\.js/
  );
});

test('2026-09-20 uses 34.71 ton midnight inventory anchor',()=>{
  assert.match(
    ui,
    /COFIRING_ORGANIC_20260920_ANCHOR_3471_V1/
  );

  assert.match(
    ui,
    /organicTargetDate==='2026-09-20'/
  );

  assert.match(
    ui,
    /anchoredStart\?34\.71:inventoryStartTotal/
  );

  const receipt=59.3;
  const endInventory=39.695;

  assert.equal(
    Number(
      (
        34.71+
        receipt-
        endInventory
      ).toFixed(3)
    ),
    54.315
  );
});

test('unit allocation must equal total organic usage before save',()=>{
  assert.match(
    ui,
    /validateOrganicAllocationBeforeSave/
  );

  assert.match(
    ui,
    /유기성 호기별 배분 합계가 총 사용량과 일치해야 합니다/
  );

  assert.match(
    ui,
    /Math\.abs\(diff\)>0\.01/
  );

  assert.match(
    ui,
    /validateOrganicAllocationBeforeSave\(values\);const ok=await manual\.save\(values\)/
  );
});

test('allocation status refreshes after cofiring calculation',()=>{
  assert.match(
    ui,
    /renderDisplay\(shown,\{adjusted\}\);updateOrganicInventoryUsage\(\);/
  );

  assert.match(
    ui,
    /호기별 배분/
  );
});

test('only the new cofiring UI build is loaded',()=>{
  assert.equal(
    (
      html.match(
        /cofiring-period-ui-v5\.js\?v=/g
      ) || []
    ).length,
    1
  );

  assert.match(
    html,
    /cofiring-period-ui-v5\.js\?v=20260920-organic-decouple-anchor-v1-r1/
  );
});
