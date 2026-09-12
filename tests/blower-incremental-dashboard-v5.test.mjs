import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2] || process.cwd());
const html = fs.readFileSync(path.join(root, 'maintenance/blower-history.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'maintenance/blower-history.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'maintenance/blower-history.js'), 'utf8');
const unifiedCss = fs.readFileSync(path.join(root, 'maintenance/blower-unified-refresh.css'), 'utf8');
const require = createRequire(import.meta.url);
const core = require(path.join(root, 'maintenance/blower-unified-refresh.js'));

test('refresh control is code-drawn SVG, not the old emoji or an image asset', () => {
  assert.match(html, /<button[^>]*id="refreshButton"[\s\S]*?<svg class="overview-refresh-icon"[^>]*viewBox="0 0 24 24"/);
  assert.match(html, /overview-refresh-icon-arrow/);
  assert.match(html, /overview-refresh-icon-ring/);
  assert.doesNotMatch(html, />\s*↻\s*</);
  assert.doesNotMatch(html, /refreshButton[\s\S]{0,500}<img\b/i);
  assert.match(css, /\.overview-refresh-icon\s*\{[\s\S]*?stroke:\s*currentColor/);
  assert.match(css, /\.overview-refresh-button\.is-spinning \.overview-refresh-icon\s*\{[\s\S]*?animation:\s*blower-overview-refresh-spin/);
  assert.match(unifiedCss, /#refreshButton\.overview-refresh-button\s*\{\s*min-width:\s*48px/);
});

test('dashboard calls one browser batch instead of serial execute/reload per Blower', () => {
  const refresh = ui.slice(ui.indexOf('async function refreshAllBlowers()'), ui.indexOf('async function refreshFbheForUnified'));
  assert.match(refresh, /core\.executeDataParcBatch\(planned\.tasks, io\)/);
  assert.doesNotMatch(refresh, /for\s*\(const task of planned\.tasks\)[\s\S]*?core\.executeDataParc\(/);
  assert.match(refresh, /await io\.reload\(\);[\s\S]*?일괄 조회 결과 반영/);
});

test('23 queued probes are created before one immediate status batch within the server 24-id limit', async () => {
  const events = [];
  const tasks = Array.from({ length: 23 }, (_, index) => {
    const tag = `TEST${String(index + 1).padStart(2, '0')}`;
    return {
      asset: { tagNumber: tag, displayName: tag },
      snapshot: {
        tagNumber: tag,
        lastReplacementAt: '2026-09-01T00:00:00+09:00',
        cycleStartState: 'legacy',
        cycleStartedAt: '',
        cycleStartRevision: '',
        cycleRuntimeRevision: `r-${index}`
      },
      startAt: '2026-09-01T00:00:00+09:00',
      queryStartAt: '2026-09-11T09:00:00+09:00',
      incremental: true,
      dataParcTag: `GSPOGE.ABB_DCS.TEST${String(index + 1).padStart(2, '0')}`
    };
  });
  const ids = new Map(tasks.map((task, index) => [task.snapshot.tagNumber, `q${index + 1}`]));

  const io = {
    assertWritable() {},
    progress() {},
    sleep: async () => {},
    api: async options => {
      if (options?.body?.action === 'create_blower_runtime_probe') {
        const tag = options.body.assetTag;
        events.push(`create:${tag}`);
        return { item: { id: ids.get(tag), status: 'processing' } };
      }
      if (typeof options?.url === 'string' && options.url.includes('action=status_batch')) {
        const parsed = new URL(`https://local${options.url}`);
        const group = decodeURIComponent(parsed.searchParams.get('ids') || '').split(',').filter(Boolean);
        events.push(`status:${group.length}`);
        assert.ok(group.length <= 24, `status_batch exceeded 24 ids: ${group.length}`);
        return { items: group.map(id => ({ id, status: 'complete' })) };
      }
      if (options?.body?.action === 'dataparc_runtime_sync') {
        events.push(`apply:${options.body.requestId}`);
        return { message: '증분 운전시간 반영 완료' };
      }
      throw new Error(`unexpected API call: ${JSON.stringify(options)}`);
    }
  };

  const results = await core.executeDataParcBatch(tasks, io);
  assert.equal(results.length, 23);
  assert.ok(results.every(result => result.status === 'complete'));
  const firstStatus = events.findIndex(event => event.startsWith('status:'));
  assert.equal(events.slice(0, firstStatus).filter(event => event.startsWith('create:')).length, 23);
  assert.deepEqual(events.filter(event => event.startsWith('status:')), ['status:23']);
  assert.equal(events.filter(event => event.startsWith('apply:')).length, 23);
});
