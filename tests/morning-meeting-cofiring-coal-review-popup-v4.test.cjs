'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const overlayPath = path.join(root, 'maintenance', 'morning-meeting-cofiring-coal-review-popup-v4.js');
const indexPath = path.join(root, 'index.html');

const api = require(overlayPath);
const source = fs.readFileSync(overlayPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');

function el({ classes = [], attrs = {}, hidden = false } = {}) {
  return {
    hidden,
    classList: { contains: name => classes.includes(name) },
    getAttribute: name => attrs[name] ?? null
  };
}
function doc(tab, view) {
  return {
    getElementById(id) {
      if (id === 'efficiencyMorningMeetingTab') return tab;
      if (id === 'efficiencyMorningMeetingView') return view;
      return null;
    }
  };
}

assert.equal(api.MARKER, 'MORNING-MEETING-COFIRING-COAL-REVIEW-POPUP-V4');
assert.match(api.TITLE, /1·2호기 석탄 사용량 검토 필요/);
assert.match(api.BODY, /Coal 사용량/);
assert.match(api.BODY, /1호기·2호기/);
assert.equal(api.isMorningMeetingActive(doc(el({ classes:['is-active'] }), el({ hidden:true, attrs:{'aria-hidden':'true'} }))), true);
assert.equal(api.isMorningMeetingActive(doc(el({ attrs:{'aria-selected':'true'} }), el({ hidden:true }))), true);
assert.equal(api.isMorningMeetingActive(doc(el(), el({ classes:['is-active'] }))), true);
assert.equal(api.isMorningMeetingActive(doc(el(), el({ hidden:false }))), true);
assert.equal(api.isMorningMeetingActive(doc(el(), el({ hidden:true, attrs:{'aria-hidden':'true'} }))), false);
assert.match(source, /stopImmediatePropagation\(\)/);
assert.match(source, /bypassButtons\.add\(button\)/);
assert.match(source, /button\.click\(\)/);
assert.match(source, /role="alertdialog"/);
assert.match(source, /확인 후 최대혼소 조정/);
assert.match(index, /morning-meeting-cofiring-coal-review-popup-v4\.js\?v=20260917-popup-v4/);

console.log('PASS: morning-meeting co-firing coal review popup V4 contracts (15).');
