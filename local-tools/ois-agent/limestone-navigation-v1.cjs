'use strict';
// The operations heading and LOG SHEET children can live in different/replaced frames.
// Re-discover the deepest visible step on every scan instead of requiring both labels in one body.
const MENUS = [
  { level: 1, labels: ['LOG SHEET조회', 'LOG SHEET 조회'], name: 'LOG SHEET조회' },
  { level: 2, labels: ['LOG SHEET'], name: 'LOG SHEET' },
  { level: 3, labels: ['운영정보'], name: '운영정보' }
];

async function findTarget(page, maximumLevel, timeoutMs, isLogSheetFrame) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (page.isClosed?.()) throw new Error('OIS browser page has been closed.');
    const frames = page.frames().filter(frame => !frame.isDetached?.());
    for (const frame of frames) {
      try {
        if (await isLogSheetFrame(frame)) return { frame, level: 0 };
      } catch { /* A replaced frame will be re-discovered in the next scan. */ }
    }
    for (const menu of MENUS.filter(menu => menu.level <= maximumLevel)) {
      for (const frame of frames) {
        for (const label of menu.labels) {
          try {
            const items = frame.getByText(label, { exact: true });
            const count = await items.count();
            for (let i = 0; i < count; i += 1) {
              if (await items.nth(i).isVisible()) return { ...menu, frame };
            }
          } catch { /* Navigation can detach a frame between count and visibility. */ }
        }
      }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(Math.min(250, deadline - Date.now()));
  } while (Date.now() < deadline);
  return null;
}

async function open(page, { timeoutMs = 15000, isLogSheetFrame, clickMenu }) {
  const stepTimeout = Math.max(250, Math.min(Number(timeoutMs) || 15000, 15000));
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let maximumLevel = 3;
    try {
      for (let step = 0; step < 4; step += 1) {
        const target = await findTarget(page, maximumLevel, stepTimeout, isLogSheetFrame);
        if (!target) throw new Error('OIS LOG SHEET 메뉴 전환을 확인하지 못했습니다.');
        if (target.level === 0) return target.frame;
        if (!await clickMenu(target.frame, target.labels, target.name)) {
          throw new Error(`OIS ${target.name} 메뉴를 열지 못했습니다.`);
        }
        // Wait for the next level; repeatedly clicking the same parent can collapse its children.
        maximumLevel = target.level - 1;
      }
      throw new Error('OIS LOG SHEET 조회 화면을 확인하지 못했습니다.');
    } catch (error) {
      lastError = error;
      if (page.isClosed?.() || /(?:page|context|browser).*closed|target closed/i.test(String(error?.message))) throw error;
      if (attempt === 0) {
        console.warn('[LIMESTONE NAV V1] Menu transition retry 1/1:', error.message);
        await page.waitForTimeout(750);
      }
    }
  }
  throw new Error(`OIS LOG SHEET 메뉴 조회 실패(2회): ${lastError?.message || '메뉴를 찾지 못했습니다.'}`);
}

module.exports = { open };
