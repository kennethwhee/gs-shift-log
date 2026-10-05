'use strict';
importScripts('vendor/auxiliary-jszip-3.10.1.min.js', 'auxiliary-excel-processor-v1.js');
self.onmessage = async event => {
  try {
    let last = 0;
    const result = await self.AuxiliaryExcelProcessorV1.build(event.data, self.JSZip, (stage, percent) => {
      const now = performance.now();
      if (percent === undefined || now - last >= 200 || percent === 100) {
        last = now; self.postMessage({type:'progress', stage, percent});
      }
    });
    self.postMessage({type:'complete', ...result}, [result.buffer]);
  } catch (error) {
    self.postMessage({type:'error', message:error?.message || '부재료 엑셀 생성에 실패했습니다.'});
  }
};
