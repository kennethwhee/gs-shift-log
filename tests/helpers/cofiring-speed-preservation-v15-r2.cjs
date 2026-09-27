'use strict';
// Test-only inverse of the exact source replacements in apply-cofiring-speed-v1.cjs.
// Does NOT edit source files, execute PowerShell, change baselines, or learn hashes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const normalize = value => {
  if (typeof value !== 'string') throw new TypeError('Preservation input must be source text.');
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
};
const rawRules = normalize(fs.readFileSync(path.join(__dirname, 'cofiring-speed-preservation-v15-r2-rules.json'), 'utf8'));
const rulesHash = crypto.createHash('sha256').update(rawRules).digest('hex');
if (rulesHash !== 'b13d38b0fb8d7538ef4a7a7b0e034384e72c554c015c6366f748a83ee46e2dad') throw new Error('Reviewed speed-preservation rules differ.');
const profiles = JSON.parse(rawRules);
function reverseRule(source, rule) {
  if (typeof source !== 'string' || !rule || typeof rule.from !== 'string' || !rule.from ||
      typeof rule.to !== 'string' || !rule.to || !Number.isInteger(rule.count) || rule.count < 1) {
    throw new TypeError('Invalid reviewed source replacement.');
  }
  const actual = source.split(rule.to).length - 1;
  if (actual !== rule.count) {
    throw new Error('Speed V1 preservation mismatch: ' + rule.label +
      '; expected ' + rule.count + ' exact occurrence(s), found ' + actual +
      '. No runtime code or baseline was modified.');
  }
  return source.split(rule.to).join(rule.from);
}
function restore(source, name) {
  const profile = profiles[name];
  if (!profile) throw new TypeError('Unknown preservation profile.');
  let text = normalize(source);
  // A legacy source still faces its original preservation hash, without a bypass.
  if (!text.includes(profile.marker)) return text;
  for (let i = profile.rules.length - 1; i >= 0; i--) text = reverseRule(text, profile.rules[i]);
  if (text.includes(profile.marker)) throw new Error('Speed V1 restoration left an unexpected marker.');
  return text;
}
module.exports = {
  normalize,
  reverseRule,
  restoreWorkerForPreservation: source => restore(source, 'worker'),
  restoreControllerForPreservation: source => restore(source, 'controller')
};
