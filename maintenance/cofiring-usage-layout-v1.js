/* Presentation only: move existing controls; keep calculation and save bindings intact. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || window.__cofiringUsageLayoutV1) return;
  window.__cofiringUsageLayoutV1 = true;

  const mounted = new WeakMap();
  const text = node => node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }
  function setTone(node, value) {
    if (node.dataset.tone !== value) node.dataset.tone = value;
  }
  function element(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    if (value) node.textContent = value;
    return node;
  }
  function refresh(state) {
    const { source, total, allocation, context, receiptSource, receiptBadge } = state;
    const tone = source.dataset.tone || '';
    const main = source.querySelector('.cfv16-organic-main');
    const strong = main && main.querySelector('strong');
    if (tone === 'ready' && strong) {
      setText(total, text(strong));
      // Copy the current allocation description without assuming a ratio or doing arithmetic.
      const description = [...main.childNodes]
        .filter(node => node.nodeType === 3 && text(node).includes('자동배분'))
        .map(node => text(node).replace(/^[·\s]+/, '')).join(' ');
      setText(allocation, description);
    } else {
      // Waiting, manual and error messages must remain visible even with details closed.
      setText(total, text(source));
      setText(allocation, '');
    }
    setTone(context, tone);
    const receiptTone = receiptSource.dataset.tone || '';
    const receiptText = text(receiptSource);
    setText(receiptBadge, receiptTone === 'ready' ? receiptText.split('·')[0].trim() : receiptText);
    setTone(receiptBadge, receiptTone);
  }
  function mount(panel) {
    if (mounted.has(panel)) return mounted.get(panel);
    const head = panel.querySelector('.cfv52-manual-head');
    const grid = panel.querySelector('.cfv52-manual-grid');
    const source = panel.querySelector('[data-cfv15-organic-usage]');
    const receipt = panel.querySelector('.cfv14-receipt-inline');
    const receiptSource = panel.querySelector('[data-cfv14-receipt-source]');
    const receiptTitle = receipt && receipt.querySelector('strong');
    const units = [...panel.querySelectorAll('.cfv52-manual-unit')];
    if (!head || !grid || !source || !receipt || !receiptSource || !receiptTitle || units.length !== 2) return null;

    const context = element('div', 'cfv-usage-context');
    context.setAttribute('role', 'status');
    context.setAttribute('aria-live', 'polite');
    const total = element('strong', 'cfv-usage-total');
    const allocation = element('span', 'cfv-usage-allocation');
    context.append(total, allocation);
    const details = element('details', 'cfv-usage-details');
    const summary = element('summary', '', '산정 근거 · 입고 내역');
    const body = element('div', 'cfv-usage-details-body');
    // Preserve the original status nodes: the runtime continues to update them in place.
    body.append(source, receiptSource);
    details.append(summary, body);
    head.after(context);
    panel.append(details);

    const receiptHead = element('div', 'cfv-usage-receipt-head');
    const receiptBadge = element('span', 'cfv-usage-receipt-badge');
    receiptBadge.setAttribute('role', 'status');
    receiptBadge.setAttribute('aria-live', 'polite');
    receiptHead.append(receiptTitle, receiptBadge);
    receipt.prepend(receiptHead);
    grid.prepend(receipt);
    for (const unit of units) {
      const legend = unit.querySelector('legend');
      if (legend && !text(legend).includes('사용량')) legend.append(document.createTextNode(' 사용량'));
    }
    panel.classList.add('cfv-usage-v1');
    const state = { source, total, allocation, context, receiptSource, receiptBadge };
    mounted.set(panel, state);
    return state;
  }

  // Keep the editable controls outside the grid that the result renderer replaces.
  // Move live nodes so input values, listeners and the native reading order survive.
  function arrangeResults(panel) {
    const sheet = panel.closest('.cfv5-sheet');
    const results = sheet && sheet.querySelector('.cfv-results-dark');
    const grid = results && results.querySelector('[data-cfv52-summary-grid]');
    if (!grid || grid.parentElement !== results) return;
    const freshTotal = grid.querySelector('.cfv52-card-total');
    const previousTotal = [...results.children].find(node => node.classList.contains('cfv52-card-total'));
    if (grid.nextElementSibling !== panel) grid.after(panel);
    if (freshTotal) {
      if (previousTotal) previousTotal.replaceWith(freshTotal);
      else panel.after(freshTotal);
    } else if (!grid.children.length && previousTotal) {
      previousTotal.remove();
    }
    const total = freshTotal || previousTotal;
    if (total && total.parentElement === results && panel.nextElementSibling !== total) panel.after(total);
    results.classList.add('cfv-compact-order-v11');
  }

  function observeView(view) {
    let scheduled = false;
    function update() {
      scheduled = false;
      for (const panel of view.querySelectorAll('.cfv52-manual-panel')) {
        const state = mount(panel);
        if (state) { refresh(state); arrangeResults(panel); }
      }
    }
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(update);
    });
    observer.observe(view, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['data-tone'] });
    update();
  }
  function start() {
    const view = document.getElementById('efficiencyCofiringDraftView');
    if (view) { observeView(view); return; }
    const waiting = new MutationObserver(() => {
      const next = document.getElementById('efficiencyCofiringDraftView');
      if (next) { waiting.disconnect(); observeView(next); }
    });
    waiting.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
