'use strict';
// Test-only exact inverse. Historical baselines are unchanged; unrelated edits remain visible.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const raw=fs.readFileSync(path.join(__dirname,'cofiring-startup-v3-preservation.json'),'utf8').replace(/\r\n/g,'\n');
if(crypto.createHash('sha256').update(raw).digest('hex')!=='c0a81a91b309413d2bad0ee082a11e059d3c5b41ae8c6fd9ced267ae29d15304')throw Error('Startup V3 reviewed inverse changed.');
const profile=JSON.parse(raw);
function restoreStartupV3(source){
 let text=source.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
 if(!text.includes(profile.marker))return text;
 for(const rule of [...profile.rules].reverse()){
  if(text.split(rule.to).length-1!==1)throw Error('Startup V3 inverse mismatch.');
  text=text.replace(rule.to,rule.from);
 }
 return text;
}
module.exports={restoreStartupV3,profile};
