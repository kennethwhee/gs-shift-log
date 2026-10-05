(function (scope) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function patchWorksheet(xml, rows) {
    if (!/<worksheet\b[^>]*\bxmlns=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/.test(xml)) {
      throw Error('부재료 원본 시트의 XML 형식이 예상과 다릅니다.');
    }
    const open = /<sheetData\b[^>]*>/.exec(xml);
    const end = xml.indexOf('</sheetData>', open ? open.index + open[0].length : 0);
    if (!open || end < 0) throw Error('부재료 원본 시트의 자료 영역을 찾지 못했습니다.');
    const start = open.index + open[0].length;
    const values = new Map();
    if (!Array.isArray(rows) || rows.length < 28 || rows.length > 31) throw Error('부재료 월간 행 수가 올바르지 않습니다.');
    rows.forEach((row, i) => {
      if (row.excelRowNumber !== i + 4 || !Array.isArray(row.values) || row.values.length !== 18) throw Error('부재료 보관 행 구조가 올바르지 않습니다.');
      row.values.forEach((value, column) => values.set(String.fromCharCode(65 + column) + row.excelRowNumber, value));
    });
    const seen = new Set();
    // Only standard A:R cells in rows 4:35 are touched. All other XML bytes,
    // including hundreds of thousands of formatted blank cells, are retained.
    const pattern = /<c\b(?=[^>]*\br=["'][A-R](?:[4-9]|[12][0-9]|3[0-5])["'])[^>]*?(?:\/>|>[\s\S]*?<\/c\s*>)/g;
    const data = xml.slice(start, end).replace(pattern, cell => {
      const tag = /^<c\b([^>]*?)(?:\/>|>)/.exec(cell);
      const reference = /(?:^|\s)r=(["'])([^"']+)\1/.exec(tag[1])?.[2];
      if (!reference) throw Error('부재료 원본 셀 주소를 읽지 못했습니다.');
      if (!values.has(reference) && reference[0] === 'A') return cell;
      if (seen.has(reference)) throw Error('부재료 원본 셀 주소가 중복되었습니다: ' + reference);
      seen.add(reference);
      const attrs = tag[1].replace(/\s+t=(["'])[^"']*\1/g, '');
      let children = tag[0].endsWith('/>') ? '' : cell.slice(tag[0].length).replace(/<\/c\s*>$/, '');
      children = children.replace(/<(f|v|is)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g, '');
      const value = values.has(reference) ? values.get(reference) : null;
      let content = '', type = '';
      if (reference[0] === 'R') {
        if (String(value ?? '')) {
          type = ' t="inlineStr"';
          content = '<is><t xml:space="preserve">' + escapeText(value) + '</t></is>';
        }
      } else if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) {
        content = '<v>' + String(Number(value)) + '</v>';
      }
      return '<c' + attrs + type + '>' + children + content + '</c>';
    });
    for (const reference of values.keys()) {
      if (!seen.has(reference)) throw Error('원본 부재료 엑셀에서 ' + reference + ' 셀을 찾지 못했습니다.');
    }
    return xml.slice(0, start) + data + xml.slice(end);
  }
  async function build(payload, Zip, progress = () => {}) {
    const clock = () => scope.performance?.now?.() ?? Date.now();
    const timings = {}, start = clock();
    progress('양식 열기');
    const zip = await Zip.loadAsync(payload.templateBuffer);
    const file = zip.file(payload.worksheetPath);
    if (!file) throw Error('선택한 월의 부재료 시트를 찾지 못했습니다.');
    const xml = await file.async('string');
    timings.openMs = clock() - start;
    progress('월간 자료 반영');
    await new Promise(resolve => scope.setTimeout(resolve, 0));
    const patchStart = clock();
    zip.file(payload.worksheetPath, patchWorksheet(xml, payload.rows));
    for (const [name, value] of Object.entries(payload.xmlFiles || {})) {
      if (!['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml'].includes(name)) throw Error('허용되지 않은 엑셀 수정 경로입니다.');
      zip.file(name, value);
    }
    zip.remove('xl/calcChain.xml');
    timings.patchMs = clock() - patchStart;
    progress('엑셀 압축');
    const zipStart = clock();
    const buffer = await zip.generateAsync({type:'arraybuffer', compression:'DEFLATE', compressionOptions:{level:1}}, meta => progress('엑셀 압축', meta.percent));
    timings.zipMs = clock() - zipStart;
    timings.workerMs = clock() - start;
    return {buffer, timings};
  }
  scope.AuxiliaryExcelProcessorV1 = Object.freeze({patchWorksheet, build, NS});
})(typeof self !== 'undefined' ? self : globalThis);
