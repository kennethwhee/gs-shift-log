'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../maintenance/solid-fuel-trouble.js'),'utf8');
const start='/* SOLID_FUEL_CONTACT_PURE_HELPERS_START */',end='/* SOLID_FUEL_CONTACT_PURE_HELPERS_END */';
assert.equal(source.split(start).length,2);
assert.equal(source.split(end).length,2);
const actual=source.split(start)[1].split(end)[0];
const context=vm.createContext({});
new vm.Script(actual+'\nglobalThis.helpers={contactDial,contactMatches};').runInContext(context);
const {contactDial,contactMatches}=context.helpers;
test('contact phone links normalize only permitted digits and an optional leading plus',()=>{
  for(const [input,output] of [['010-1234-5678','01012345678'],['031 123 4567','0311234567'],['+82 (10) 1234-5678','+821012345678'],[' 02-123-4567 ','021234567'],['1234567','1234567'],['123456789012345','123456789012345']])assert.equal(contactDial(input),output);
});
test('contact phone links reject unsafe URI and control characters rather than embedding raw input',()=>{
  for(const input of ['',null,undefined,'javascript:alert(1)','tel:01012345678','https://example.invalid','0101234;5678','0101234#5678','++821012345678','010+12345678','0101234"5678','0101234<5678','0101234\n5678','\n01012345678','01012345678\r','0101234\u00005678','01012345678\u007f','123456','1234567890123456','0'.repeat(41)])assert.equal(contactDial(input),'',String(input));
});
test('emergency contact search finds company, driver and formatted or unformatted phone numbers',()=>{
  const row={companyName:'테스트 연료',driverName:'가상 기사',phoneNumber:'010-1234-5678'};
  for(const term of ['','  ','테스트','연료','가상','기사','010-1234','0101234','12345678','(010) 1234'])assert.equal(contactMatches(row,term),true,term);
  for(const term of ['다른 업체','다른 기사','99999999','기사010','javascript:010'])assert.equal(contactMatches(row,term),false,term);
});
test('search has no regular-expression execution and handles incomplete contact fields',()=>{
  assert.equal(contactMatches({companyName:'ACME (A+B)',driverName:'Driver Kim',phoneNumber:'+82 10 1234 5678'},'driver KIM'),true);
  assert.equal(contactMatches({companyName:'ACME (A+B)',driverName:'',phoneNumber:''},'(A+B)'),true);
  assert.equal(contactMatches({},'123'),false);
  assert.equal(contactMatches({companyName:'one'},'['),false);
});
