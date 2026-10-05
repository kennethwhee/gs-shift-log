/* Copy missing month sheets inside the export ZIP; the source XLSX is read-only. */
(function (scope) {
  'use strict';
  const fail = message => { throw Error('부재료 월별 양식 생성: ' + message); };
  const attr = (xml, name) => new RegExp('(?:^|\\s)' + name.replace(':', '\\:') + '=["\']([^"\']*)["\']').exec(xml)?.[1];
  const setAttr = (tag, name, value) => {
    const re = new RegExp('\\s' + name + '=["\'][^"\']*["\']');
    return re.test(tag) ? tag.replace(re, ' ' + name + '="' + value + '"') : tag.replace(/\/?\>$/, end => ' ' + name + '="' + value + '"' + end);
  };
  const tags = (xml, name) => [...xml.matchAll(new RegExp('<' + name + '\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/' + name + '>)', 'g'))].map(x => x[0]);
  const read = async (zip, name) => { const file = zip.file(name); if (!file) fail('필수 파일 없음: ' + name); return file.async('string'); };
  const append = (xml, parent, value) => {
    if (xml.includes('</' + parent + '>')) return xml.replace('</' + parent + '>', value + '</' + parent + '>');
    const re = new RegExp('<' + parent + '\\b[^>]*/>');
    if (!re.test(xml)) fail(parent + ' 영역 없음');
    return xml.replace(re, tag => tag.slice(0, -2) + '>' + value + '</' + parent + '>');
  };
  const resolve = (base, target) => {
    if (!target || /[?#\\]/.test(target)) fail('지원하지 않는 연결 경로');
    const parts = (target.startsWith('/') ? target.slice(1) : base.slice(0, base.lastIndexOf('/') + 1) + target).split('/'), out = [];
    for (const part of parts) { if (part === '..') { if (!out.length) fail('잘못된 연결 경로'); out.pop(); } else if (part && part !== '.') out.push(part); }
    return out.join('/');
  };
  const relPath = part => part.slice(0, part.lastIndexOf('/') + 1) + '_rels/' + part.slice(part.lastIndexOf('/') + 1) + '.rels';
  const nextPath = (zip, directory, prefix, extension) => {
    for (let n = 1; n < 100000; n++) { const name = directory + '/' + prefix + n + extension; if (!zip.file(name)) return name; }
    fail('새 양식 파일 번호를 만들지 못했습니다.');
  };
  const rebase = (text, source, target) => text.split("'" + source + "'!").join("'" + target + "'!");
  const selectView = (xml, selected) => xml.replace(/<sheetView\b[^>]*>/g, tag => setAttr(tag, 'tabSelected', selected ? 1 : 0));

  async function ensure(zip, sheetName, dayCount) {
    if (!/^\d{4}\.(0[1-9]|1[0-2])$/.test(sheetName)) fail('월 이름이 올바르지 않습니다.');
    const [year, month] = sheetName.split('.').map(Number);
    if (year < 1900 || dayCount !== new Date(Date.UTC(year, month, 0)).getUTCDate()) fail('선택 월의 날짜 수가 일치하지 않습니다.');
    let workbook = await read(zip, 'xl/workbook.xml');
    let relations = await read(zip, 'xl/_rels/workbook.xml.rels');
    let types = await read(zip, '[Content_Types].xml');
    const sheets = tags(workbook, 'sheet');
    const relationships = tags(relations, 'Relationship');
    const sheetPath = sheet => {
      const links = relationships.filter(r => attr(r, 'Id') === attr(sheet, 'r:id'));
      if (links.length !== 1 || !attr(links[0], 'Type')?.endsWith('/worksheet') || attr(links[0], 'TargetMode')) fail('시트 연결 정보가 올바르지 않습니다.');
      const result = resolve('xl/workbook.xml', attr(links[0], 'Target'));
      if (!zip.file(result)) fail('시트 XML 파일이 없습니다.');
      return result;
    };
    const existing = sheets.filter(s => attr(s, 'name') === sheetName);
    if (existing.length > 1) fail('월 이름이 중복되었습니다.');
    if (existing.length) return {worksheetPath:sheetPath(existing[0]), created:false};
    const monthly = sheets.filter(s => /^\d{4}\.(0[1-9]|1[0-2])$/.test(attr(s, 'name') || ''));
    monthly.sort((a, b) => attr(b, 'name').localeCompare(attr(a, 'name')));
    if (!monthly.length) fail('복사할 월별 시트가 없습니다.');
    const source = monthly[0], sourceName = attr(source, 'name'), sourceIndex = sheets.indexOf(source);
    const sourcePath = sheetPath(source), worksheetPath = nextPath(zip, 'xl/worksheets', 'sheet', '.xml');
    let worksheet = await read(zip, sourcePath);
    // Copied local formulas follow the new sheet. Numeric data is replaced separately.
    worksheet = worksheet.replace(/<f\b[^>]*>[\s\S]*?<\/f>/g, text => rebase(text, sourceName, sheetName));
    worksheet = worksheet.replace(/<sheetPr\b[^>]*>/g, tag => tag.replace(/\s+codeName=["'][^"']*["']/g, ''));
    worksheet = selectView(worksheet, true);
    // Reserve the new path before allocating related parts.
    zip.file(worksheetPath, worksheet);
    const copyType = (from, to) => {
      const overrides = tags(types, 'Override').filter(t => attr(t, 'PartName') === '/' + from);
      if (overrides.length > 1) fail('중복된 파일 형식 정의');
      if (overrides.length) types = append(types, 'Types', setAttr(overrides[0], 'PartName', '/' + to));
      else if (!tags(types, 'Default').some(t => attr(t, 'Extension') === from.split('.').pop())) fail('파일 형식 정의 없음');
    };
    copyType(sourcePath, worksheetPath);
    const sourceRels = zip.file(relPath(sourcePath));
    if (sourceRels) {
      let copiedRels = await sourceRels.async('string');
      for (const relation of tags(copiedRels, 'Relationship')) {
        // Actual archive template contains only a drawing and printer settings.
        // Stop on new structures (tables/charts/etc.) instead of sharing unsafe IDs.
        const kind = attr(relation, 'Type')?.split('/').pop();
        if (attr(relation, 'TargetMode') || !['drawing', 'printerSettings'].includes(kind)) fail('검토가 필요한 시트 연결: ' + kind);
        const from = resolve(sourcePath, attr(relation, 'Target'));
        if (!zip.file(from) || zip.file(relPath(from))) fail('검토가 필요한 부속 양식: ' + from);
        const folder = kind === 'drawing' ? 'xl/drawings' : 'xl/printerSettings';
        const to = nextPath(zip, folder, kind, kind === 'drawing' ? '.xml' : '.bin');
        zip.file(to, await zip.file(from).async('uint8array'));
        copyType(from, to);
        copiedRels = copiedRels.replace(relation, setAttr(relation, 'Target', '/' + to));
      }
      zip.file(relPath(worksheetPath), copiedRels);
    }
    const sheetIds = sheets.map(s => Number(attr(s, 'sheetId')));
    if (sheetIds.some(n => !Number.isSafeInteger(n) || n < 1)) fail('잘못된 시트 번호');
    let id = 1; while (relationships.some(r => attr(r, 'Id') === 'rId' + id)) id++;
    workbook = append(workbook, 'sheets', '<sheet name="' + sheetName + '" sheetId="' + (Math.max(...sheetIds) + 1) + '" r:id="rId' + id + '"/>');
    const sourceLink = relationships.find(r => attr(r, 'Id') === attr(source, 'r:id'));
    relations = append(relations, 'Relationships', setAttr(setAttr(sourceLink, 'Id', 'rId' + id), 'Target', '/' + worksheetPath));
    // Append instead of inserting, so every existing localSheetId remains valid.
    const localNames = tags(workbook, 'definedName').filter(n => attr(n, 'localSheetId') === String(sourceIndex));
    const copiedNames = localNames.map(name => {
      // Change the opening tag without interpreting formula text as attributes.
      let copy = name.replace(/^<definedName\b[^>]*>/, tag => setAttr(tag, 'localSheetId', sheets.length));
      copy = rebase(copy, sourceName, sheetName);
      const key = attr(name, 'name');
      if (key === 'StartDate' || key === 'EndDate') {
        const iso = sheetName.replace('.', '-') + '-' + (key === 'StartDate' ? '01 00:00:00' : String(dayCount).padStart(2, '0') + ' 23:59:59');
        copy = copy.replace(/>[\s\S]*<\/definedName>$/, '>"' + iso + '"</definedName>');
      }
      return copy;
    }).join('');
    if (copiedNames) workbook = append(workbook, 'definedNames', copiedNames);
    const oldActive = Number(attr(tags(workbook, 'workbookView')[0] || '', 'activeTab') || 0);
    for (const index of new Set([sourceIndex, oldActive])) {
      if (!sheets[index]) continue;
      const oldPath = sheetPath(sheets[index]);
      const oldXml = await read(zip, oldPath), unselected = selectView(oldXml, false);
      if (oldXml !== unselected) zip.file(oldPath, unselected);
    }
    if (!/<workbookView\b/.test(workbook)) fail('통합문서 보기 설정 없음');
    workbook = workbook.replace(/<workbookView\b[^>]*>/g, tag => setAttr(tag, 'activeTab', sheets.length));
    // Keep optional Excel property vectors consistent with appended sheets/names.
    if (zip.file('docProps/app.xml')) {
      let app = await read(zip, 'docProps/app.xml');
      const titles = /<TitlesOfParts>\s*<vt:vector\b[^>]*>([\s\S]*?)<\/vt:vector>\s*<\/TitlesOfParts>/.exec(app);
      if (!titles) fail('문서 속성의 시트 목록을 읽지 못했습니다.');
      const entries = tags(titles[1], 'vt:lpstr');
      if (entries.length < sheets.length) fail('문서 속성의 시트 수가 다릅니다.');
      const newNames = entries.slice(sheets.length).filter(t => t.includes("'" + sourceName + "'!")).map(t => rebase(t, sourceName, sheetName));
      const all = [...entries.slice(0, sheets.length), '<vt:lpstr>' + sheetName + '</vt:lpstr>', ...entries.slice(sheets.length), ...newNames];
      app = app.replace(titles[0], '<TitlesOfParts><vt:vector size="' + all.length + '" baseType="lpstr">' + all.join('') + '</vt:vector></TitlesOfParts>');
      let count = 0;
      app = app.replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, pairs => pairs.replace(/<vt:i4>(\d+)<\/vt:i4>/g, (tag, value) => {
        count++; const expected = count === 1 ? sheets.length : entries.length - sheets.length;
        if (count > 2 || Number(value) !== expected) fail('문서 속성의 항목 수가 다릅니다.');
        return '<vt:i4>' + (Number(value) + (count === 1 ? 1 : newNames.length)) + '</vt:i4>';
      }));
      if (count !== 2) fail('문서 속성의 항목 구성이 다릅니다.');
      zip.file('docProps/app.xml', app);
    }
    zip.file('xl/workbook.xml', workbook);
    zip.file('xl/_rels/workbook.xml.rels', relations);
    zip.file('[Content_Types].xml', types);
    return {worksheetPath, created:true, sourceName, sheetName};
  }
  scope.AuxiliaryExcelMonthSheetV2 = Object.freeze({ensure});
})(typeof self !== 'undefined' ? self : globalThis);
