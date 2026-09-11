'use strict';
// Dependency-free DOM model for inherited tests. Real Chromium checks are provided separately.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
class Element {
 constructor(attributes={}){this.attributes=attributes;this.dataset={};for(const[name,value]of Object.entries(attributes))if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,l)=>l.toUpperCase())]=value;this.value=attributes.value||'';this.listeners={};this.disabled=false;this.hidden=false;this.textContent='';this.classList={add(){}};this._html='';this.children=[];this.parent=null;}
 set innerHTML(value){this._html=value;this.children=[];for(const match of value.matchAll(/<[a-z][^>]*\bdata-cf-[^>]*>/g)){const attrs={};for(const a of match[0].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]||'';const e=new Element(attrs);e.parent=this;this.children.push(e);}}
 get innerHTML(){return this._html;}
 querySelectorAll(selector){const m=/^\[([^=\]]+)(?:="([^\"]+)")?\]$/.exec(selector),out=[];for(const child of this.children){if(m&&Object.hasOwn(child.attributes,m[1])&&(m[2]===undefined||child.attributes[m[1]]===m[2]))out.push(child);out.push(...child.querySelectorAll(selector));}return out;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 appendChild(child){if(child.parent)child.parent.children=child.parent.children.filter(c=>c!==child);child.parent=this;this.children.push(child);return child;}
 addEventListener(type,callback){(this.listeners[type]||=[]).push(callback);}
 setAttribute(key,value){this.attributes[key]=value;}
 closest(){return null;}
 focus(){}
 async fire(type,event={target:this}){for(const fn of this.listeners[type]||[])await fn(event);}
 click(){return this.fire('click');}
}
function makeHarness(options={}){
 const repo=path.join(__dirname,'../..'),core=require(path.join(repo,'maintenance/cofiring-core.js'));
 const original=JSON.parse(fs.readFileSync(path.join(repo,'maintenance/cofiring-draft-reference.json'),'utf8'));
 let calls=0;const container=new Element(),document={readyState:'loading',addEventListener(){},createElement(){return new Element();},querySelector(){return null;},getElementById(){return null;}};
 const context=vm.createContext({CofiringCore:core,console,document,fetch:async(...args)=>{calls++;if(options.fetch)return options.fetch(...args);return {ok:true,json:async()=>JSON.parse(JSON.stringify(original))};}});
 for(const name of ['cofiring-organic-storage.js','cofiring-manure-storage.js','cofiring-settings-storage.js','cofiring-draft.js'])vm.runInContext(fs.readFileSync(path.join(repo,'maintenance',name),'utf8'),context);
 const controller=context.CofiringDraft.mount(container,{reference:options.reference});
 return {container,controller,find:s=>container.querySelector(`[data-cf-${s}]`),all:s=>container.querySelectorAll(`[data-cf-${s}]`),get calls(){return calls;}};
}
module.exports={Element,makeHarness};
