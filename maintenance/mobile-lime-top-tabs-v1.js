(function () {
  var STYLE_ID = 'mobile-lime-top-tabs-v1-style';
  var LIMESTONE_LABEL = '석회석 관리';
  var HYDRATED_LABEL = '소석회 관리';

  function isMobileViewport() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '/* ===== MOBILE LIME TOP TABS V1 ===== */',
      '@media (max-width: 900px) {',
      '  .mlttv1-group {',
      '    display: flex !important;',
      '    gap: 10px !important;',
      '    padding: 6px !important;',
      '    margin: 4px 0 8px 0 !important;',
      '    background: #eef3fb !important;',
      '    border: 1px solid #d8e1ef !important;',
      '    border-radius: 16px !important;',
      '    box-sizing: border-box !important;',
      '  }',
      '',
      '  .mlttv1-tab {',
      '    flex: 1 1 0 !important;',
      '    min-height: 42px !important;',
      '    height: 42px !important;',
      '    padding: 0 12px !important;',
      '    border-radius: 12px !important;',
      '    border: 1px solid #cfd8e6 !important;',
      '    background: #ffffff !important;',
      '    color: #5f6f86 !important;',
      '    display: inline-flex !important;',
      '    align-items: center !important;',
      '    justify-content: center !important;',
      '    gap: 8px !important;',
      '    font-size: 15px !important;',
      '    font-weight: 700 !important;',
      '    line-height: 1 !important;',
      '    box-shadow: none !important;',
      '    text-align: center !important;',
      '    white-space: nowrap !important;',
      '  }',
      '',
      '  .mlttv1-tab.mlttv1-active {',
      '    background: linear-gradient(180deg, #4d8df7 0%, #2f6ce8 100%) !important;',
      '    color: #ffffff !important;',
      '    border-color: #3a78ef !important;',
      '    box-shadow: 0 6px 14px rgba(52, 111, 231, 0.20) !important;',
      '  }',
      '',
      '  .mlttv1-icon {',
      '    display: inline-flex !important;',
      '    align-items: center !important;',
      '    justify-content: center !important;',
      '    width: 18px !important;',
      '    height: 18px !important;',
      '    flex: 0 0 18px !important;',
      '  }',
      '',
      '  .mlttv1-icon svg {',
      '    width: 18px !important;',
      '    height: 18px !important;',
      '    display: block !important;',
      '    stroke: currentColor !important;',
      '    fill: none !important;',
      '    stroke-width: 1.9 !important;',
      '    stroke-linecap: round !important;',
      '    stroke-linejoin: round !important;',
      '  }',
      '',
      '  .mlttv1-label {',
      '    display: inline-block !important;',
      '    overflow: hidden !important;',
      '    text-overflow: ellipsis !important;',
      '  }',
      '',
      '  .mlttv1-tab::before,',
      '  .mlttv1-tab::after {',
      '    display: none !important;',
      '    content: none !important;',
      '  }',
      '',
      '  .mlttv1-group + * {',
      '    margin-top: 4px !important;',
      '  }',
      '',
      '  @media (max-width: 430px) {',
      '    .mlttv1-group {',
      '      gap: 8px !important;',
      '      padding: 5px !important;',
      '      border-radius: 14px !important;',
      '    }',
      '',
      '    .mlttv1-tab {',
      '      min-height: 40px !important;',
      '      height: 40px !important;',
      '      font-size: 14px !important;',
      '      padding: 0 10px !important;',
      '      border-radius: 11px !important;',
      '      gap: 6px !important;',
      '    }',
      '',
      '    .mlttv1-icon, .mlttv1-icon svg {',
      '      width: 16px !important;',
      '      height: 16px !important;',
      '    }',
      '  }',
      '}'
    ].join('\n');

    document.head.appendChild(style);
  }

  function limestoneIconSvg() {
    return '' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M5 16.5 9 7.5 16 6.5 19.5 13 14.5 18 7.5 18Z"></path>' +
      '<path d="M9 7.5 12.5 12 19.5 13"></path>' +
      '</svg>';
  }

  function hydratedIconSvg() {
    return '' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 4 18 7.5V15L12 18.5 6 15V7.5Z"></path>' +
      '<path d="M12 4V11"></path>' +
      '<path d="M6 7.5 12 11 18 7.5"></path>' +
      '<path d="M12 11V18.5"></path>' +
      '</svg>';
  }

  function hasActiveHint(el) {
    if (!el) return false;

    var ariaPressed = el.getAttribute('aria-pressed');
    var ariaSelected = el.getAttribute('aria-selected');
    var dataSelected = el.getAttribute('data-selected');
    var dataActive = el.getAttribute('data-active');
    var className = String(el.className || '');

    if (ariaPressed === 'true') return true;
    if (ariaSelected === 'true') return true;
    if (dataSelected === 'true') return true;
    if (dataActive === 'true') return true;
    if (/\b(active|selected|current|on|is-active)\b/i.test(className)) return true;

    return false;
  }

  function getButtonsByLabel() {
    var nodes = Array.prototype.slice.call(
      document.querySelectorAll('button, [role="tab"], a, .tab, .btn')
    );

    var candidates = nodes.filter(function (el) {
      var t = normalizeText(el.textContent);
      return t === LIMESTONE_LABEL || t === HYDRATED_LABEL;
    });

    return candidates;
  }

  function findPair(buttons) {
    for (var i = 0; i < buttons.length; i++) {
      for (var j = i + 1; j < buttons.length; j++) {
        var a = buttons[i];
        var b = buttons[j];

        if (!a.parentElement || !b.parentElement) continue;
        if (a.parentElement !== b.parentElement) continue;

        var ta = normalizeText(a.textContent);
        var tb = normalizeText(b.textContent);

        if (
          (ta === LIMESTONE_LABEL && tb === HYDRATED_LABEL) ||
          (ta === HYDRATED_LABEL && tb === LIMESTONE_LABEL)
        ) {
          return [a, b];
        }
      }
    }

    return null;
  }

  function getKind(label) {
    return label === LIMESTONE_LABEL ? 'limestone' : 'hydrated';
  }

  function ensureIconAndLabel(el, label) {
    if (!el.querySelector('.mlttv1-icon')) {
      var icon = document.createElement('span');
      icon.className = 'mlttv1-icon';
      icon.innerHTML = label === LIMESTONE_LABEL
        ? limestoneIconSvg()
        : hydratedIconSvg();

      el.insertBefore(icon, el.firstChild);
    }

    var existingLabel = el.querySelector('.mlttv1-label');
    if (!existingLabel) {
      var raw = normalizeText(el.textContent);
      el.textContent = '';
      var iconEl = el.querySelector('.mlttv1-icon');
      if (iconEl) el.appendChild(iconEl);

      var labelSpan = document.createElement('span');
      labelSpan.className = 'mlttv1-label';
      labelSpan.textContent = raw;
      el.appendChild(labelSpan);
    }
  }

  function detectInitialActive(buttons) {
    for (var i = 0; i < buttons.length; i++) {
      if (hasActiveHint(buttons[i])) {
        return getKind(normalizeText(buttons[i].textContent));
      }
    }

    return 'limestone';
  }

  function applyActive(buttons, activeKind) {
    buttons.forEach(function (btn) {
      var label = normalizeText(btn.textContent);
      var kind = getKind(label);
      btn.classList.toggle('mlttv1-active', kind === activeKind);
      btn.setAttribute('data-mlttv1-kind', kind);
    });
  }

  function decorate(buttons) {
    if (!buttons || buttons.length !== 2) return;

    var parent = buttons[0].parentElement;
    if (!parent) return;

    parent.classList.add('mlttv1-group');

    buttons.forEach(function (btn) {
      var label = normalizeText(btn.textContent);
      btn.classList.add('mlttv1-tab');
      ensureIconAndLabel(btn, label);
    });

    var activeKind = detectInitialActive(buttons);
    applyActive(buttons, activeKind);

    buttons.forEach(function (btn) {
      if (btn.__mlttv1Bound) return;
      btn.__mlttv1Bound = true;

      btn.addEventListener('click', function () {
        var label = normalizeText(btn.textContent);
        var kind = getKind(label);
        window.setTimeout(function () {
          applyActive(buttons, kind);
        }, 0);
      });
    });
  }

  function enhance() {
    if (!isMobileViewport()) return;
    ensureStyle();

    var buttons = getButtonsByLabel();
    var pair = findPair(buttons);
    if (!pair) return;

    decorate(pair);
  }

  function boot() {
    enhance();

    var observer = new MutationObserver(function () {
      enhance();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener('resize', enhance);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();