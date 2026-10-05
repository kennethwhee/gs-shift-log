'use strict';
// Test-only inverse of the reviewed archive change. Historic safety baselines remain unchanged.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const raw=fs.readFileSync(path.join(__dirname,'cofiring-phase2-archive-preservation.json'),'utf8').replace(/\r\n/g,'\n');
if(crypto.createHash('sha256').update(raw).digest('hex')!=='f3e9bfe16afdbe476764e7dc850315fff3e3f8c753c96cd0eb0b5392f726a052')throw Error('Archive preservation mapping differs.');
const profile=JSON.parse(raw);
function restorePhase2Archive(source){
  if(typeof source!=='string')throw new TypeError('Source text required.');
  let text=source.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  if(!text.includes(profile.marker))return text;
  for(const rule of profile.rules){
    if(text.split(rule.to).length-1!==rule.count)throw Error('Archive preservation replacement mismatch.');
    text=text.split(rule.to).join(rule.from);
  }
  return text;
}
module.exports={restorePhase2Archive};
