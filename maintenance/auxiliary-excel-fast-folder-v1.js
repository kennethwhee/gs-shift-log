/* AUXILIARY_EXCEL_FAST_FOLDER_V1: explicit export only, no OIS requests. */
(function () {
  'use strict';
  if (window.auxiliaryMaterialExcelExportV1) return;
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const VERSION = '20261005-v1';
  const TEMPLATE = '/assets/templates/auxiliary-material-archive-template.xlsx?v=aux-export-' + VERSION;
  const byId = id => document.getElementById(id);
  const now = () => performance.now();
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  let templatePromise = null, zipPromise = null, directory = null, folderReady = false;
  let permissionNeeded = false, remembered = true, running = false, choosing = false, started = 0, lastProgress = 0;
  const notify = message => typeof showToast === 'function' ? showToast(message) : window.alert(message);
  const mobile = () => typeof isAuxiliaryMaterialMobileMonitorMode === 'function' && isAuxiliaryMaterialMobileMonitorMode();
  const supported = () => window.isSecureContext && typeof window.showDirectoryPicker === 'function';

  function databaseAction(mode, operation) {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(Error('저장 폴더 기억 기능을 사용할 수 없습니다.')); return; }
      const request = indexedDB.open('gs-auxiliary-excel-output-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        let tx, result;
        try {
          tx = db.transaction('settings', mode);
          const action = operation(tx.objectStore('settings'));
          action.onsuccess = () => { result = action.result; };
          tx.oncomplete = () => { db.close(); resolve(result); };
          tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error('저장 폴더 설정 처리 실패')); };
        } catch (error) { db.close(); reject(error); }
      };
    });
  }

  function ensureControls() {
    const download = byId('downloadAuxiliaryMaterialExcelButton');
    if (!download || mobile()) { const existing = byId('auxiliaryExcelFolderControls'); if (existing) existing.hidden = true; return; }
    let group = byId('auxiliaryExcelFolderControls');
    if (!group) {
      group = document.createElement('span'); group.id = 'auxiliaryExcelFolderControls';
      const choose = document.createElement('button'); choose.id = 'auxiliaryExcelFolderSelect'; choose.type = 'button';
      choose.addEventListener('click', chooseFolder);
      const label = document.createElement('span'); label.id = 'auxiliaryExcelFolderName';
      const reset = document.createElement('button'); reset.id = 'auxiliaryExcelFolderReset'; reset.type = 'button'; reset.textContent = '기본 다운로드';
      reset.addEventListener('click', resetFolder);
      const status = document.createElement('span'); status.id = 'auxiliaryExcelProgress'; status.setAttribute('role','status');
      group.append(choose, label, reset, status);
    }
    group.hidden = false;
    if (download.nextSibling !== group) download.parentNode.insertBefore(group, download.nextSibling);
    renderControls();
  }

  function renderControls() {
    const choose = byId('auxiliaryExcelFolderSelect'), label = byId('auxiliaryExcelFolderName'), reset = byId('auxiliaryExcelFolderReset');
    if (!choose) return;
    choose.textContent = !directory ? '저장 폴더 지정' : permissionNeeded ? '폴더 권한 확인' : '폴더 변경';
    choose.disabled = running || choosing || !folderReady || !supported();
    choose.title = !supported() ? '이 브라우저에서는 기본 다운로드를 사용합니다.' : '부재료 엑셀을 저장할 폴더를 선택합니다.';
    label.textContent = directory ? directory.name + (permissionNeeded ? ' · 권한 필요' : '') : '';
    label.title = directory ? directory.name + (remembered ? ' · 이 브라우저에서 기억됨' : ' · 이번 접속에서만 사용') : '';
    reset.hidden = !directory; reset.disabled = running || choosing;
  }

  async function chooseFolder() {
    if (running || choosing || !supported()) return;
    choosing = true; renderControls();
    try {
      if (directory && permissionNeeded) {
        const permission = await directory.requestPermission({mode:'readwrite'});
        permissionNeeded = permission !== 'granted';
        if (permissionNeeded) notify('저장 폴더의 쓰기 권한이 필요합니다. 기본 다운로드를 선택할 수도 있습니다.');
        return;
      }
      const handle = await window.showDirectoryPicker({id:'gs-auxiliary-excel', mode:'readwrite', startIn:directory || 'downloads'});
      directory = handle; permissionNeeded = false; remembered = true;
      try { await databaseAction('readwrite', store => store.put(handle, 'folder')); }
      catch (_) { remembered = false; notify('폴더는 지정됐지만 다음 접속까지 기억하지 못했습니다.'); }
    } catch (error) {
      if (error?.name !== 'AbortError') notify(error?.message || '저장 폴더를 지정하지 못했습니다.');
    } finally { choosing = false; renderControls(); }
  }

  async function resetFolder() {
    if (running || choosing) return;
    choosing = true; renderControls();
    try {
      await databaseAction('readwrite', store => store.delete('folder'));
      directory = null; permissionNeeded = false; remembered = true;
    } catch (_) { notify('폴더 설정을 해제하지 못했습니다. 다시 시도해 주세요.'); }
    finally { choosing = false; renderControls(); }
  }

  function progress(stage, percent) {
    const time = now();
    if (percent !== undefined && percent !== 100 && time - lastProgress < 200) return;
    lastProgress = time;
    const status = byId('auxiliaryExcelProgress');
    if (status) status.textContent = stage + (percent === undefined ? '' : ' ' + Math.floor(percent) + '%') + (started ? ' · ' + ((time - started)/1000).toFixed(1) + '초' : '');
  }

  function getTemplate() {
    if (!templatePromise) {
      templatePromise = fetch(TEMPLATE, {cache:'default'}).then(response => {
        if (!response.ok) throw Error('부재료 원본 엑셀을 불러오지 못했습니다. (' + response.status + ')');
        return response.arrayBuffer();
      }).catch(error => { templatePromise = null; throw error; });
    }
    return templatePromise;
  }

  function getZip() {
    if (typeof window.JSZip === 'function') return Promise.resolve(window.JSZip);
    if (!zipPromise) zipPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/maintenance/vendor/auxiliary-jszip-3.10.1.min.js';
      script.onload = () => typeof window.JSZip === 'function' ? resolve(window.JSZip) : reject(Error('엑셀 라이브러리를 읽지 못했습니다.'));
      script.onerror = () => reject(Error('엑셀 라이브러리를 불러오지 못했습니다.'));
      document.head.appendChild(script);
    }).catch(error => { zipPromise = null; throw error; });
    return zipPromise;
  }

  async function processWorkbook(payload, Zip) {
    if (typeof window.Worker === 'function') {
      try {
        const result = await new Promise((resolve, reject) => {
          const worker = new Worker('/maintenance/auxiliary-excel-worker-v1.js?v=' + VERSION);
          const timeout = setTimeout(() => finish(Error('엑셀 생성 시간이 초과되었습니다. 다시 시도해 주세요.')), 120000);
          function finish(error, value) { clearTimeout(timeout); worker.terminate(); error ? reject(error) : resolve(value); }
          worker.onmessage = ({data}) => {
            if (data.type === 'progress') progress(data.stage, data.percent);
            else if (data.type === 'complete') finish(null, data);
            else if (data.type === 'error') finish(Error(data.message));
          };
          worker.onerror = () => { const error = Error('엑셀 작업 모듈을 시작하지 못했습니다.'); error.workerUnavailable = true; finish(error); };
          try {
            const copy = payload.templateBuffer.slice(0);
            worker.postMessage({...payload, templateBuffer:copy}, [copy]);
          } catch (error) { error.workerUnavailable = true; finish(error); }
        });
        return {...result, mode:'worker'};
      } catch (error) {
        if (!error.workerUnavailable && error.name !== 'SecurityError') throw error;
      }
    }
    await pause();
    return {...await window.AuxiliaryExcelProcessorV1.build(payload, Zip, progress), mode:'compatible'};
  }

  async function createWorkbook() {
    const began = now(), timings = {templateMemoryHit:Boolean(templatePromise)};
    progress('저장자료·양식 준비');
    // Capture the selected month synchronously before any await; D1 is always fresh.
    const dataPromise = fetchAuxiliaryMaterialArchiveMonthData();
    const [archiveData, templateBuffer, Zip] = await Promise.all([dataPromise, getTemplate(), getZip()]);
    timings.prepareMs = now() - began;
    const archiveRows = createAuxiliaryMaterialArchiveRows(archiveData);
    const zip = await Zip.loadAsync(templateBuffer);
    const worksheetPath = await findAuxiliaryMaterialArchiveWorksheetPath(zip, archiveData.sheetName);
    // Reuse existing calculation-chain/recalculation rules on the small XML parts.
    await removeAuxiliaryMaterialArchiveCalcChain(zip);
    await prepareAuxiliaryMaterialArchiveRecalculation(zip);
    const xmlFiles = {};
    for (const name of ['xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml']) {
      if (zip.file(name)) xmlFiles[name] = await zip.file(name).async('string');
    }
    const processed = await processWorkbook({templateBuffer, worksheetPath, rows:archiveRows.map(row => ({excelRowNumber:row.excelRowNumber, values:row.values})), xmlFiles}, Zip);
    const fileName = '#1, 2 BLR 부재료 사용량 변화 비교_' + archiveData.year + '_' + archiveData.monthText + '월_보관본.xlsx';
    Object.assign(timings, processed.timings, {mode:processed.mode, buildMs:now() - began});
    window.__auxiliaryMaterialExcelLastTiming = timings;
    return {blob:new Blob([processed.buffer],{type:MIME}), fileName, archiveData, archiveRows,
      savedDateCount:archiveData.savedDateCount, calendarDayCount:archiveData.calendarDayCount, timings};
  }

  async function saveToFolder(handle, blob, fileName) {
    if (await handle.queryPermission({mode:'readwrite'}) !== 'granted') throw Error('저장 폴더 권한이 해제되었습니다. 폴더 권한을 확인한 뒤 다시 다운로드해 주세요.');
    const safe = String(fileName).replace(/[\\/:*?"<>|]/g,'_');
    const dot = safe.lastIndexOf('.'), stem = dot > 0 ? safe.slice(0,dot) : safe, ext = dot > 0 ? safe.slice(dot) : '';
    const save = async () => {
      for (let i=0;i<10000;i++) {
        const candidate = stem + (i ? ' (' + i + ')' : '') + ext;
        try { await handle.getFileHandle(candidate); continue; }
        catch (error) { if (error.name === 'TypeMismatchError') continue; if (error.name !== 'NotFoundError') throw error; }
        const file = await handle.getFileHandle(candidate,{create:true});
        let writable;
        try { writable = await file.createWritable(); await writable.write(blob); await writable.close(); }
        catch (error) { if (writable?.abort) await writable.abort().catch(()=>{}); throw error; }
        return candidate;
      }
      throw Error('같은 이름의 파일이 너무 많습니다. 저장 폴더를 변경해 주세요.');
    };
    return navigator.locks?.request ? navigator.locks.request('gs-auxiliary-export:' + handle.name + ':' + safe, save) : save();
  }

  async function download() {
    const button = byId('downloadAuxiliaryMaterialExcelButton');
    if (!button || button.disabled || running || choosing || mobile()) return;
    if (!folderReady) { notify('저장 폴더 설정을 확인하고 있습니다. 잠시 후 다시 눌러 주세요.'); return; }
    const destination = directory;
    running = true; started = now(); lastProgress = 0;
    setAuxiliaryMaterialArchiveDownloadButtonState(true); renderControls();
    try {
      // Permission is requested while handling the user's click, before fetching/processing.
      if (destination && await destination.requestPermission({mode:'readwrite'}) !== 'granted') {
        permissionNeeded = true;
        throw Error('저장 폴더 권한을 허용하거나 기본 다운로드를 선택해 주세요.');
      }
      permissionNeeded = false;
      progress('저장자료·양식 준비');
      const result = await createWorkbook();
      progress('파일 저장');
      const savedName = destination ? await saveToFolder(destination,result.blob,result.fileName) : result.fileName;
      if (!destination) downloadAuxiliaryMaterialArchiveBlob(result.blob, result.fileName);
      const seconds = ((now()-started)/1000).toFixed(1);
      window.__auxiliaryMaterialExcelLastTiming.totalMs = now()-started;
      progress('완료');
      notify(result.archiveData.year + '년 ' + result.archiveData.month + '월 부재료 엑셀 ' +
        (destination ? '저장 완료 · ' + destination.name + ' / ' + savedName : '다운로드 시작') +
        ' · ' + seconds + '초 · D1 저장 ' + result.savedDateCount + '/' + result.calendarDayCount + '일');
    } catch (error) {
      progress('저장 실패'); notify(error?.message || '부재료 엑셀을 저장하지 못했습니다.');
      console.error('[AUXILIARY EXCEL EXPORT]', error);
    } finally {
      running = false; started = 0; setAuxiliaryMaterialArchiveDownloadButtonState(false); renderControls();
    }
  }

  async function initialize() {
    ensureControls();
    try {
      directory = supported() ? await databaseAction('readonly', store => store.get('folder')) || null : null;
      if (directory?.kind !== 'directory') directory = null;
      if (directory) permissionNeeded = await directory.queryPermission({mode:'readwrite'}) !== 'granted';
    } catch (_) { directory = null; }
    finally { folderReady = true; ensureControls(); }
  }

  window.auxiliaryMaterialExcelExportV1 = Object.freeze({createWorkbook, download, saveToFolder, ensureControls});
  createAuxiliaryMaterialArchiveWorkbook = createWorkbook;
  handleAuxiliaryMaterialArchiveDownload = download;
  const originalPrepare = prepareAuxiliaryMaterialPcCompactControls;
  prepareAuxiliaryMaterialPcCompactControls = function (...args) {
    const result = originalPrepare.apply(this,args); ensureControls(); return result;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else void initialize();
})();
