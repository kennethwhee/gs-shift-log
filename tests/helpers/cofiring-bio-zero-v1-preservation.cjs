'use strict';
// Test-only inverse of the reviewed aggregation delta. All historical hashes stay unchanged.
// An unexpected edit is never mapped to a historical baseline.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const normalize=source=>{
  if(typeof source!=='string')throw new TypeError('Preservation source must be text.');
  return source.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
};
const sha=source=>crypto.createHash('sha256').update(source).digest('hex');
const raw=normalize(fs.readFileSync(path.join(__dirname,'cofiring-bio-zero-v1-preservation.json'),'utf8'));
if(sha(raw)!=='64a6ac47b5b719ad878510e03c52f565e7bb3370a295049f883513b9fb70ea54')throw Error('Bio zero reviewed inverse changed.');
const profile=JSON.parse(raw);
function restoreBioZero(source){
  let text=normalize(source);
  if(sha(text)!==profile.productionNormalizedSha256)return text;
  for(const rule of [...profile.rules].reverse()){
    if(!rule.to||text.split(rule.to).length-1!==rule.count)throw Error('Bio zero exact inverse mismatch.');
    text=text.split(rule.to).join(rule.from);
  }
  if(sha(text)!==profile.previousNormalizedSha256)throw Error('Bio zero inverse did not restore the exact reviewed worker.');
  return text;
}
module.exports={restoreBioZero,normalize,profile};
