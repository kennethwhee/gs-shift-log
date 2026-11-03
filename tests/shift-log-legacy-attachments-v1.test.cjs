const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function load(relative, context = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
    .replace(/^import\s[^\n]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const sandbox = vm.createContext({console: {warn() {}, error() {}}, TextEncoder, ...context});
  vm.runInContext(source, sandbox, {filename: relative});
  return sandbox;
}
const helper = load('functions/_shared/legacy-shift-log-attachments.js');
const api = load('functions/api/shift-logs.js', {hydrateLegacyShiftLogAttachments: helper.hydrateLegacyShiftLogAttachments});
const fileApi = load('functions/api/shift-log-files.js', {attachmentStateForShiftLogRow: helper.attachmentStateForShiftLogRow});
const plain = value => JSON.parse(JSON.stringify(value));
function migrated(extra = {}) {
  return {id:'legacy-diary-1', legacyDiaryId:'diary-1', date:'2026-07-21', shift:'NS', role:'TO',
    legacyAttachmentCount:1, attachments:[{id:1,name:'사진.png',url:'/api/legacy-attachment?id=1'}], ...extra};
}
function legacy(extra = {}) {
  return {id:1,legacy_diary_id:'diary-1',file_name:'사진.png',mime_type:'image/png',file_size:100,
    legacy_work_date:'2026-07-21',legacy_shift:'NS',legacy_role:'TO', ...extra};
}
function modern(extra = {}) {
  return {id:'modern-1',log_id:'legacy-diary-1',original_name:'새파일.pdf',content_type:'application/pdf',file_size:200,...extra};
}
function database({legacyRows=[], modernRows=[], failLegacy=false, failModern=false, malformedModern=false}={}) {
  const db = {queries:[],writes:0,stored:null,prepare(sql) {
    let values=[];
    return {bind(...args){values=args;return this;},async all(){
      db.queries.push({sql,values});
      if (sql.includes('FROM legacy_attachments AS a')) {
        assert.match(sql,/INNER JOIN legacy_logs AS l ON l\.legacy_diary_id = a\.legacy_diary_id/);
        assert(values.length<=80);
        if(failLegacy)throw Error('legacy unavailable');
        return {results:legacyRows.filter(r=>values.includes(r.legacy_diary_id))};
      }
      if (sql.includes('FROM shift_log_attachments')) {
        if(failModern)throw Error('modern unavailable');
        if(malformedModern)return {success:false};
        return {results:modernRows.filter(r=>values.includes(r.log_id))};
      }
      throw Error('Unexpected read '+sql);
    },async run(){
      if(!sql.includes('INSERT INTO shift_logs'))throw Error('Unexpected write');
      db.writes++;
      db.stored={id:values[0],work_date:values[1],shift:values[2],role:values[3],team:values[4],author:values[5],author_id:values[6],author_role:values[7],status:values[8],log_json:values[9],revision:1};
      return {meta:{changes:1}};
    },async first(){
      if(!sql.includes('FROM shift_logs'))throw Error('Unexpected first');
      return db.stored;
    }};
  }};
  return db;
}

test('migration stores legacy references and immediate shared-D1 response retains authoritative attachment',async()=>{
  const db=database({legacyRows:[legacy()]});
  const log=migrated({author:'직원',authorId:'123',authorRole:'user',status:'결재완료',team:'A'});
  const saved=await api.insertLog(db,log,{name:'직원',employeeNo:'123'});
  assert.equal(JSON.parse(db.stored.log_json).attachments.length,1);
  assert.equal(saved.source,'shared-d1');
  assert.equal(saved.attachments.length,1);
  assert.equal(saved.attachments[0].url,'/api/legacy-attachment?id=1');
  assert.equal(saved.legacyAttachmentCount,1);
  assert.equal(saved.attachmentLoadStatus,'complete');
  assert.equal(db.writes,1);
});

test('read recovers already erased JSON references without a write',async()=>{
  const db=database({legacyRows:[legacy()]});
  const [log]=await api.attachShiftLogAttachments(db,[migrated({attachments:[]})]);
  assert.equal(log.attachments.length,1);assert.equal(db.writes,0);
});

test('mixed modern and legacy attachments stay distinct even when numeric IDs collide',async()=>{
  const db=database({legacyRows:[legacy(),legacy()],modernRows:[modern({id:'1'})]});
  const [log]=await api.attachShiftLogAttachments(db,[migrated()]);
  assert.deepEqual(plain(log.attachments.map(a=>a.url)),['/api/shift-log-files?id=1','/api/legacy-attachment?id=1']);
  assert.equal(log.legacyAttachmentCount,2);
});

test('authoritative empty legacy lookup clears stale count and stale serialized refs',async()=>{
  const db=database();const [log]=await api.attachShiftLogAttachments(db,[migrated({legacyAttachmentCount:5})]);
  assert.equal(log.attachments.length,0);assert.equal(log.legacyAttachmentCount,0);assert.equal(log.attachmentLoadError,false);
});

test('exact diary/date/shift/role relationship prevents unrelated attachments',async()=>{
  const db=database({legacyRows:[legacy({legacy_diary_id:'other'}),legacy({legacy_shift:'DS'}),legacy({legacy_role:'BO1'}),legacy({legacy_work_date:'2026-07-20'})]});
  const [log]=await api.attachShiftLogAttachments(db,[migrated()]);assert.equal(log.attachments.length,0);
});

test('legacy lookup failure preserves known refs/count and modern data without claiming complete',async()=>{
  const db=database({failLegacy:true,modernRows:[modern()]});
  const [log]=await api.attachShiftLogAttachments(db,[migrated({legacyAttachmentCount:3})]);
  assert.equal(log.attachments.length,2);assert.equal(log.legacyAttachmentCount,3);
  assert.equal(log.attachmentLoadStatus,'partial');assert.equal(log.attachmentLoadError,true);
});

test('missing legacy schema with erased refs is partial, never authoritative zero',async()=>{
  const db=database({failLegacy:true});const [log]=await api.attachShiftLogAttachments(db,[migrated({attachments:[]})]);
  assert.equal(log.legacyAttachmentCount,1);assert.equal(log.attachmentLoadStatus,'partial');
});

test('modern lookup failure stays partial even when legacy lookup succeeds',async()=>{
  const db=database({failModern:true,legacyRows:[legacy()]});
  const prior={id:'m-1',url:'/api/shift-log-files?id=m-1',name:'보관파일.pdf'};
  const [log]=await api.attachShiftLogAttachments(db,[migrated({attachments:[prior],legacyAttachmentCount:2})]);
  assert.equal(log.attachments.length,2);assert.equal(log.attachmentLoadStatus,'partial');assert.equal(log.legacyAttachmentCount,2);
});

test('ordinary new logs perform no legacy query, including absent legacy schema',async()=>{
  const db=database({failLegacy:true,modernRows:[modern({log_id:'new-log'})]});
  const [log]=await api.attachShiftLogAttachments(db,[{id:'new-log',attachments:[],legacyAttachmentCount:4}]);
  assert.equal(db.queries.length,1);assert.equal(log.attachments.length,1);assert.equal(log.legacyAttachmentCount,1);assert.equal(log.attachmentLoadStatus,'complete');
});

test('legacy ID fallback and placeholder filtering match existing legacy endpoint',async()=>{
  const db=database({legacyRows:[legacy(),legacy({id:2,file_name:'유첨 : 제목'}),legacy({id:3,file_name:'제목'})]});
  const [log]=await api.attachShiftLogAttachments(db,[migrated({legacyDiaryId:''})]);
  assert.equal(log.attachments.length,1);
});

test('legacy reads are batched and preserve groups beyond 80 IDs',async()=>{
  const logs=Array.from({length:81},(_,i)=>migrated({id:'legacy-d'+i,legacyDiaryId:'d'+i,attachments:[]}));
  const rows=logs.map((log,i)=>legacy({id:i+1,legacy_diary_id:log.legacyDiaryId}));
  const db=database({legacyRows:rows});const hydrated=await api.attachShiftLogAttachments(db,logs);
  assert(hydrated.every(log=>log.attachments.length===1));
  assert.equal(db.queries.filter(q=>q.sql.includes('FROM legacy_attachments AS a')).length,2);
});

test('GET/upload shared row state includes merged legacy list using trusted row group',async()=>{
  const db=database({legacyRows:[legacy()]});
  const row={id:'legacy-diary-1',work_date:'2026-07-21',shift:'NS',role:'TO',log_json:JSON.stringify(migrated({attachments:[],date:'wrong',role:'BO1'}))};
  const state=await helper.attachmentStateForShiftLogRow(db,row,[fileApi.convertAttachmentRow(modern())]);
  assert.equal(state.attachments.length,2);assert.equal(state.legacyAttachmentCount,2);assert.equal(state.attachmentLoadStatus,'complete');
  assert.equal(db.writes,0);
});


test('malformed modern D1 response preserves count and declares partial',async()=>{
  const db=database({malformedModern:true,legacyRows:[legacy()]});
  const [log]=await api.attachShiftLogAttachments(db,[migrated({attachments:[],legacyAttachmentCount:2})]);
  assert.equal(log.attachmentLoadStatus,'partial');assert.equal(log.attachmentLoadError,true);assert.equal(log.legacyAttachmentCount,2);
});

function fileHandlerFixture(db) {
  class FixtureFile {
    constructor(){this.name='추가.pdf';this.type='application/pdf';this.size=10;}
    stream(){return 'fixture-stream';}
  }
  const handlers=load('functions/api/shift-log-files.js', {
    attachmentStateForShiftLogRow:helper.attachmentStateForShiftLogRow,
    URL,Response,File:FixtureFile,crypto:require('node:crypto').webcrypto
  });
  const logRow={id:'legacy-diary-1',work_date:'2026-07-21',shift:'NS',role:'TO',
    author_id:'123',status:'임시저장',log_json:JSON.stringify(migrated({attachments:[]}))};
  handlers.getAuthenticatedUser=async()=>({user:{name:'직원',employeeNo:'123',role:'user'}});
  handlers.findShiftLogRow=async()=>logRow;
  handlers.canModifyShiftLogAttachments=()=>true;
  let modernFiles=[];
  handlers.getAttachmentRowsByLogId=async()=>modernFiles;
  const originalPrepare=db.prepare.bind(db);
  db.prepare=sql=>{
    if(!sql.includes('INSERT INTO shift_log_attachments'))return originalPrepare(sql);
    return {bind(){return this;},async run(){db.writes++;modernFiles=[modern({id:'uploaded'})];return {meta:{changes:1}};}};
  };
  return {handlers,FixtureFile};
}

test('actual GET list response includes recovered attachment and never reports authoritative zero on failure',async()=>{
  for(const failLegacy of [false,true]){
    const db=database({legacyRows:[legacy()],failLegacy});const {handlers}=fileHandlerFixture(db);
    const response=await handlers.handleGet({env:{DB:db},request:{url:'https://fixture.invalid/api/shift-log-files?logId=legacy-diary-1'}});
    assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.totalCount,failLegacy?null:1);assert.equal(result.legacyAttachmentCount,1);
    assert.equal(result.attachmentLoadStatus,failLegacy?'partial':'complete');assert.equal(db.writes,0);
  }
});

test('actual successful upload response retains legacy reference alongside new attachment',async()=>{
  const db=database({legacyRows:[legacy()]});const {handlers,FixtureFile}=fileHandlerFixture(db);
  let uploads=0;
  const response=await handlers.onRequestPost({
    env:{DB:db,ATTACHMENTS:{async put(){uploads++;},async delete(){throw Error('unexpected rollback');}}},
    request:{headers:{get(){return 'multipart/form-data; boundary=test';}},async formData(){return {get(){return 'legacy-diary-1';},getAll(){return [new FixtureFile()];}};}}
  });
  assert.equal(response.status,201);const result=await response.json();
  assert.equal(uploads,1);assert.equal(result.uploadedCount,1);assert.equal(result.attachments.length,2);
  assert.equal(result.totalCount,2);assert.equal(result.legacyAttachmentCount,2);
  assert.equal(result.attachments[1].source,'legacy');
});


test('file-list malformed D1 response is an explicit failure, not an empty authoritative list',async()=>{
  const isolated=load('functions/api/shift-log-files.js', {attachmentStateForShiftLogRow:helper.attachmentStateForShiftLogRow});
  isolated.ensureShiftLogAttachmentsTable=async()=>{};
  await assert.rejects(isolated.getAttachmentRowsByLogId(database({malformedModern:true}),'legacy-diary-1'),/SHIFT_LOG_ATTACHMENT_RESULT_UNAVAILABLE/);
});
