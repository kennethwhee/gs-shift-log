'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'maintenance', name), 'utf8');
const cardCode = read('morning-meeting-cofiring-card.js');
const adjustmentCode = read('morning-meeting-cofiring-adjustment.js');
const excelCode = read('morning-meeting-cofiring-final-excel.js');
const dateA = '2026-09-25';
const dateB = '2026-09-26';
const valueId = suffix => 'efficiencyMorningMeetingCofiring' + suffix;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise, resolve, reject}; };
const saved = (date = dateA) => ({
  targetDate: date, revision: 7, source: 'cofiring-closed-history', updatedAt: '2026-09-26T00:02:00Z',
  unitOne: {coal: 710.31, bio: 321.78, organic: 23.12, manure: 11.11, bioRatio: 22.34567, organicRatio: 4.67891, totalRatio: 27.02458},
  unitTwo: {coal: 430.76, bio: 109.11, organic: 14.77, manure: 8.91, bioRatio: 18.23456, organicRatio: 7.12345, totalRatio: 25.35801},
  combined: {bioRatio: 21.44221, organicRatio: 5.99881, totalRatio: 27.44102}
});

function harness({providerMode = true} = {}) {
  const nodes = new Map(), listeners = new Map(), network = [], loads = [], timers = new Map();
  let selectedDate = dateA, blocked = false, stored = null, status = 'idle', nextLoad = null, timerSeq = 0;
  class Element {
    constructor(id = '') {
      this.id = id; this.textContent = ''; this.dataset = {}; this.attributes = new Map();
      this.className = ''; this.hidden = false; this.disabled = false; this.events = new Map();
      const names = new Set(); this.classList = {add: x => names.add(x), remove: x => names.delete(x), contains: x => names.has(x), toggle: (x,b) => b ? names.add(x) : names.delete(x)};
    }
    addEventListener(type, fn) { this.events.set(type, fn); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key); }
    querySelector(selector) { return selector === '.morning-meeting-cofiring-card__meta' ? nodes.get('meta') : null; }
    querySelectorAll() { return []; }
    appendChild(node) { node.parentElement = this; nodes.set(node.id, node); }
    insertBefore(node) { this.appendChild(node); }
    closest(selector) { return selector === '#' + this.id ? this : null; }
    remove() { nodes.delete(this.id); }
  }
  class Button extends Element {}
  class Input extends Element {}
  const ids = ['parent', 'meta', 'efficiencyMorningMeetingAutoSiloCard', 'efficiencyMorningMeetingAutoCofiringCard',
    'morningMeetingCofiringSettingsModal', valueId('Date'), valueId('Status'), 'efficiencyMorningMeetingAutoDailyPowerDate'];
  const suffixes = ['Unit1CoalUsage', 'Unit1BioUsage', 'Unit1BioRatio', 'Unit2CoalUsage', 'Unit2BioUsage', 'Unit2BioRatio',
    'Unit1OrganicInput', 'Unit1OrganicRatio', 'Unit1TotalRatio', 'Unit2OrganicInput', 'Unit2OrganicRatio', 'Unit2TotalRatio'];
  for (const id of [...ids, ...suffixes.map(valueId)]) nodes.set(id, new Element(id));
  for (const id of ['morningMeetingCofiringRefreshButton', 'morningMeetingCofiringCalorificButton', 'morningMeetingCofiringAdjustmentButton']) nodes.set(id, new Button(id));
  const parent = nodes.get('parent'), source = nodes.get('efficiencyMorningMeetingAutoSiloCard'), card = nodes.get('efficiencyMorningMeetingAutoCofiringCard');
  source.parentElement = parent; card.parentElement = parent; card.previousElementSibling = source;
  nodes.get('morningMeetingCofiringCalorificButton').parentElement = nodes.get('meta');
  nodes.get('efficiencyMorningMeetingAutoDailyPowerDate').textContent = dateA;
  nodes.get(valueId('Date')).textContent = dateA;
  const document = {
    readyState: 'loading', body: new Element('body'),
    getElementById: id => nodes.get(id) || null,
    createElement: tag => tag === 'button' ? new Button() : new Element(),
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); }
  };
  const provider = {
    targetDate: () => selectedDate, isBlocked: () => blocked,
    state: () => ({status}), peek: date => !blocked && stored?.targetDate === date ? stored : null,
    async load(date, options) {
      loads.push({date, options}); status = 'loading'; stored = null;
      try { const result = nextLoad ? await nextLoad.promise : saved(date); stored=result; status=result?'complete':'missing'; return result; }
      catch (error) { status='error'; throw error; }
    }
  };
  const window = {
    location: {origin: 'https://example.test'},
    setTimeout(fn) { const id=++timerSeq; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    setInterval() { return 1; }, clearInterval() {}, alert() {},
    isMorningMeetingSelectedDateResetActive: () => blocked
  };
  if (providerMode) window.morningMeetingClosedCofiring = provider;
  const context = vm.createContext({window, document, Element, HTMLElement: Element, HTMLButtonElement: Button, HTMLInputElement: Input,
    MutationObserver: class { observe() {} disconnect() {} }, URL, console: {warn(){},error(){},log(){}},
    fetch: async (...args) => { network.push(args); throw Error('Unexpected legacy network request'); }
  });
  return {
    window, document, context, nodes, network, loads, provider, timers,
    run: code => vm.runInContext(code, context),
    emit: (type, detail) => { for (const fn of listeners.get(type) || []) fn({detail}); },
    setDate: date => { selectedDate=date; }, setBlocked: value => { blocked=value; },
    setNext: value => { nextLoad=value; }, setStored: (value, nextStatus='complete') => { stored=value; status=nextStatus; },
    text: suffix => nodes.get(valueId(suffix)).textContent,
    values: () => suffixes.map(suffix => nodes.get(valueId(suffix)).textContent)
  };
}

test('card renders exact saved units and ratios; refresh reads closed history only and labels source', async () => {
  const h=harness(); h.run(cardCode);
  await h.window.refreshMorningMeetingCofiringCard({force:true});
  assert.equal(h.text('Unit1CoalUsage'), '710.31 t/d');
  assert.equal(h.text('Unit1OrganicInput'), '23.12 t/d');
  assert.equal(h.text('Unit1BioRatio'), '22.35%');
  assert.equal(h.text('Unit1OrganicRatio'), '4.68%');
  assert.equal(h.text('Unit1TotalRatio'), '27.02%');
  assert.equal(h.text('Status'), '마감자료');
  assert.equal(h.text('Date'), dateA+'\n마감자료');
  assert.equal(h.loads.length, 1); assert.equal(h.loads[0].options.force, true); assert.equal(h.network.length, 0);
  assert.equal(h.nodes.get('morningMeetingCofiringCalorificButton').disabled, true);
  assert.match(h.nodes.get('morningMeetingCofiringCalorificButton').title, /혼소율 메뉴/);
  assert.equal(h.window.getMorningMeetingCofiringEffectiveValues().unitOne.bioRatio, 22.34567);
});

test('loading, missing and failed closed records clear all previous values and effective snapshot', async () => {
  for (const outcome of ['missing','error']) {
    const h=harness(); h.run(cardCode); await h.window.refreshMorningMeetingCofiringCard();
    const d=deferred(); h.setNext(d); const refresh=h.window.refreshMorningMeetingCofiringCard({force:true});
    assert.ok(h.values().every(x=>x==='-')); assert.equal(h.window.getMorningMeetingCofiringEffectiveValues(),null);
    if(outcome==='missing') d.resolve(null); else d.reject(Error('failed request'));
    await refresh;
    assert.ok(h.values().every(x=>x==='-'));
    assert.equal(h.text('Status'), outcome==='missing'?'마감자료 없음':'마감자료 조회 실패');
  }
});

test('late closed response cannot repaint another canonical date or a reset date', async () => {
  for (const reset of [false,true]) {
    const h=harness(); h.run(cardCode); h.emit('DOMContentLoaded');
    const d=deferred(); h.setNext(d); const refresh=h.window.refreshMorningMeetingCofiringCard();
    if(reset) { h.setBlocked(true); h.emit('morningMeetingSelectedDateResetStateChanged',{targetDate:dateA,active:true}); }
    else h.setDate(dateB);
    d.resolve(saved(dateA)); await refresh;
    assert.ok(h.values().every(x=>x==='-'));
    assert.equal(h.window.getMorningMeetingCofiringEffectiveValues(),null);
    assert.equal(h.nodes.get('morningMeetingCofiringRefreshButton').disabled,false);
  }
});

test('provider change event clears and updates the card without requesting legacy data', async () => {
  const h=harness(); h.run(cardCode); h.emit('DOMContentLoaded');
  h.setStored(saved()); h.emit('morningMeetingClosedCofiringChanged',{targetDate:dateA});
  assert.equal(h.text('Unit1BioRatio'),'22.35%');
  h.setStored(null,'loading'); h.emit('morningMeetingClosedCofiringChanged',{targetDate:dateA});
  assert.ok(h.values().every(x=>x==='-')); assert.equal(h.text('Status'),'마감자료 조회 중');
  h.setStored(null,'error'); h.emit('morningMeetingClosedCofiringChanged',{targetDate:dateA});
  assert.equal(h.text('Status'),'마감자료 조회 실패'); assert.equal(h.network.length,0);
});

test('old morning adjustment is disabled and makes no legacy requests in closed mode', async () => {
  const h=harness(); h.run(adjustmentCode); h.emit('DOMContentLoaded');
  await h.window.refreshMorningMeetingCofiringAdjustment();
  assert.equal(h.network.length,0);
  const button=h.nodes.get('morningMeetingCofiringAdjustmentButton');
  assert.equal(button.disabled,true); assert.match(button.title,/혼소율 메뉴/);
});

test('an in-flight legacy adjustment cannot overwrite a closed card when provider becomes active', async () => {
  const h=harness({providerMode:false}), d=deferred();
  h.context.fetch=async url=>{
    h.network.push(String(url)); await d.promise;
    const body=String(url).includes('/ois-data-requests') ? {items:[{targetDate:dateA,requestType:'daily_data_excel',result:{coalUsageUnitOne:100,bioUsageUnitOne:20,organicUsageUnitOne:1,coalUsageUnitTwo:100,bioUsageUnitTwo:20,organicUsageUnitTwo:1}}]} :
      String(url).includes('adjustments') ? {adjustment:{mode:'manual_transfer',fromUnit:1,bioTransferTons:2}} :
      {setting:{coalKcalPerKg:6000,bioKcalPerKg:3000,organicKcalPerKg:2000}};
    return {ok:true,text:async()=>JSON.stringify(body)};
  };
  h.run(adjustmentCode); const refresh=h.window.refreshMorningMeetingCofiringAdjustment();
  h.window.morningMeetingClosedCofiring=h.provider;
  h.nodes.get(valueId('Unit1BioUsage')).textContent='321.78 t/d';
  d.resolve(); await refresh;
  assert.equal(h.text('Unit1BioUsage'),'321.78 t/d'); assert.equal(h.network.length,3);
});

test('final Excel uses saved unrounded ratios and stored combined values rather than averages', () => {
  const h=harness(); h.setStored(saved()); h.run(excelCode);
  const values=h.window.getMorningMeetingCofiringExcelValues();
  assert.equal(values.source,'cofiring-closed-history');
  assert.equal(values.unitOneBioRatio,22.34567);
  assert.equal(values.unitOneOrganicRatio,4.67891);
  assert.equal(values.bioAverageRatio,21.44221);
  assert.equal(values.organicAverageRatio,5.99881);
  const written=new Map(); h.window.setMorningMeetingNumericCellValue=(_,address,value)=>{written.set(address,value);return{found:true,written:value!==null,cleared:value===null};};
  const result=h.window.applyMorningMeetingCofiringExcelValues({});
  assert.equal(result.appliedCount,12); assert.equal(written.get('AE7'),4.67891); assert.equal(written.get('X9'),21.44221);
});

test('final Excel clears closed-data cells on missing, loading, reset, and wrong-date records despite stale DOM', () => {
  for (const scenario of ['missing','loading','error','reset','wrong-date']) {
    const h=harness(); h.nodes.get(valueId('Unit1BioUsage')).textContent='999 t/d';
    h.window.getMorningMeetingCofiringEffectiveValues=()=>saved();
    h.setStored(scenario==='wrong-date'?saved(dateB):saved(),['missing','loading','error'].includes(scenario)?scenario:'complete');
    if(scenario==='reset')h.setBlocked(true);
    h.run(excelCode); const written=[];
    h.window.setMorningMeetingNumericCellValue=(_,address,value)=>{written.push(value);return{found:true,written:value!==null,cleared:value===null};};
    const result=h.window.applyMorningMeetingCofiringExcelValues({});
    assert.equal(result.clearedCount,12,scenario); assert.ok(written.every(x=>x===null),scenario);
  }
});


test('worksheet and asynchronous export wrapper keep captured reset/date guards after the UI changes', async () => {
  for (const useWrapper of [false, true]) {
    for (const scenario of ['captured-reset', 'date-changed']) {
      const h=harness(); h.setStored(saved());
      const d=deferred();
      if(useWrapper)h.window.applyMorningMeetingDailyDataValues=()=>d.promise;
      h.run(excelCode);
      const written=[];
      h.window.setMorningMeetingNumericCellValue=(_,address,value)=>{written.push(value);return{found:true,written:value!==null,cleared:value===null};};
      const options={targetDate:dateA,suppressClosedValues:scenario==='captured-reset'};
      let pending;
      if(useWrapper)pending=h.window.applyMorningMeetingDailyDataValues({}, {}, options);
      // The reset has now ended, or the user has selected another loaded day.
      h.setBlocked(false);
      if(scenario==='date-changed'){h.setDate(dateB);h.setStored(saved(dateB));}
      let result;
      if(useWrapper){d.resolve({base:true});result=(await pending).cofiringFuelResult;}
      else result=h.window.applyMorningMeetingCofiringExcelValues({}, options);
      assert.equal(result.clearedCount,12,scenario); assert.ok(written.every(value=>value===null));
      assert.equal(result.suppressed,scenario==='captured-reset');
      assert.equal(result.dateMismatch,scenario==='date-changed');
    }
  }
});
