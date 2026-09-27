'use strict';
// A selector/event model for the mounted co-firing tests. It implements the
// attribute operations used by the real UI; it is not a layout/browser test.
class Element {
  constructor(attributes = {}) {
    this.attributes = { ...attributes }; this.dataset = {};
    this.value = attributes.value || ''; this.hidden = Object.hasOwn(attributes, 'hidden');
    this.disabled = Object.hasOwn(attributes, 'disabled'); this.textContent = '';
    this.children = []; this.listeners = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  set innerHTML(value) {
    this.html = value; this.children = [];
    for (const tag of value.matchAll(/<[a-z][^>]*\bdata-cfv[^>]*>/g)) {
      const attrs = {};
      for (const a of tag[0].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] || '';
      this.children.push(new Element(attrs));
    }
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(s => /^\[([^=\]]+)(?:="([^"]+)")?\]$/.exec(s.trim()));
    return this.children.flatMap(child => [
      ...(selectors.some(m => m && Object.hasOwn(child.attributes, m[1]) &&
        (m[2] === undefined || child.attributes[m[1]] === m[2])) ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  closest() { return null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type) { for (const fn of this.listeners[type] || []) await fn({ target: this }); }
}

// The saved report contract includes inventory beside reference, not inside it.
// 150 t opening + 30 t receipts - 160 t closing = 20 t, 10 t per unit.
function inventoryReport(reference) {
  const { inventoryDefinitions } = require('../../maintenance/cofiring-live-contract.js');
  const start = { organicDaySilo: 20, organicStorageSiloA: 80, organicStorageSiloB: 50, total: 150 };
  const end = { organicDaySilo: 10, organicStorageSiloA: 90, organicStorageSiloB: 60, total: 160 };
  const startTime = reference.startLocal + ':00+09:00', endTime = reference.endLocal + ':00+09:00';
  return { reference, organicInventoryReady: true, organicInventory: {
    schemaVersion: 1, basis: 'dataparc_period_boundary', startLocal: reference.startLocal, endLocal: reference.endLocal,
    start, end, samples: inventoryDefinitions.map(def => ({ ...def,
      startValue: start[def.key], endValue: end[def.key], startTime, endTime,
      startQuality: 'Good', endQuality: 'Good', boundaryValid: true, dataComplete: true,
      durationGoodSeconds: (Date.parse(endTime) - Date.parse(startTime)) / 1000,
      durationBadSeconds: 0, durationCoverageValid: true
    }))
  } };
}
async function receiptFetch(url) {
  const request = new URL(url, 'https://fixture.invalid');
  if (request.pathname === '/api/cofiring-closed-history') return { ok: true, json: async () => ({ok:true,item:null}) };
  if (request.pathname !== '/api/solid-fuel-trouble') throw new Error('Unmodeled request: ' + request.pathname);
  return { ok: true, json: async () => ({ ok: true, source: 'solid-fuel-unloading', basis: 'completed-unloading-departure',
    receiptStart: request.searchParams.get('receiptStart'), receiptEnd: request.searchParams.get('receiptEnd'),
    receipts: { organic: 30, manure: 0 }, counts: { organic: 1, manure: 0 }
  }) };
}
module.exports = { Element, inventoryReport, receiptFetch };
