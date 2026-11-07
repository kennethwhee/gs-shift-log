import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../maintenance/blower-history.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../maintenance/blower-r6-review.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../maintenance/blower-r6-review.css',import.meta.url),'utf8');
test('R6 panel is opt-in, target-specific, initially hidden, with explicit approval',()=>{
 assert.match(html,/id="blowerR6Panel"[^>]+hidden/);
 for(const id of ['blowerR6Start','blowerR6Continue','blowerR6Cancel','blowerR6Approve','blowerR6Confirmation','blowerR6Note','blowerR6Status'])
   assert.match(html,new RegExp(`id="${id}"`));
 assert.match(js,/action:'begin'/);assert.match(js,/action:'approve'/);
 assert.match(js,/confirmation!==TAG/);assert.match(js,/root\.confirm\(/);
 assert.match(js,/document\.readyState/);
 assert.match(js,/const URL='\/api\/blower-r6-rebaseline',TAG='204SDF01AN002'/);
 assert.doesNotMatch(js,/\b(?:eval|Function)\(/);
 assert.match(css,/\.blower-r6-panel/);
});
