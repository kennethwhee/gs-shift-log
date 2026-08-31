(() => {
  'use strict';

  const SOURCE_CARD_ID = 'efficiencyMorningMeetingAutoSiloCard';
  const TURBINE_CARD_SELECTOR =
    '.efficiency-morning-meeting-auto-card.is-gear-pinion';
  const CARD_BODY_SELECTOR = '.efficiency-morning-meeting-auto-card__body';
  const CARD_META_SELECTOR = '.efficiency-morning-meeting-auto-card__meta';
  const MERGED_CARD_CLASS = 'is-turbine-silo-merged';
  const SOURCE_HIDDEN_CLASS = 'is-turbine-silo-source-hidden';
  const MIRROR_BODY_CLASS =
    'efficiency-morning-meeting-turbine-silo-merge__body';
  const PROXY_BUTTON_CLASS =
    'efficiency-morning-meeting-turbine-silo-merge__query';

  let observedSourceCard = null;
  let sourceObserver = null;
  let layoutObserver = null;
  let syncQueued = false;

  function queueSync() {
    if (syncQueued) {
      return;
    }

    syncQueued = true;

    window.requestAnimationFrame(() => {
      syncQueued = false;
      bindSourceCard();
      syncMergedCard();
    });
  }

  function getSourceCard() {
    return document.getElementById(SOURCE_CARD_ID);
  }

  function getTurbineCard() {
    return document.querySelector(TURBINE_CARD_SELECTOR);
  }

  function stripIdentifiers(root) {
    if (!(root instanceof Element)) {
      return;
    }

    if (root.hasAttribute('id')) {
      root.removeAttribute('id');
    }

    root.querySelectorAll('[id]').forEach((element) => {
      element.removeAttribute('id');
    });

    const referenceAttributes = [
      'for',
      'aria-controls',
      'aria-describedby',
      'aria-labelledby',
      'aria-owns'
    ];

    root.querySelectorAll('*').forEach((element) => {
      referenceAttributes.forEach((attributeName) => {
        if (element.hasAttribute(attributeName)) {
          element.removeAttribute(attributeName);
        }
      });
    });
  }

  function findSourceQueryButton(sourceCard) {
    if (!(sourceCard instanceof Element)) {
      return null;
    }

    const header = sourceCard.querySelector(
      '.efficiency-morning-meeting-auto-card__header'
    );

    if (!(header instanceof Element)) {
      return null;
    }

    const buttons = Array.from(header.querySelectorAll('button'));

    return (
      buttons.find((button) => /개별\s*조회/.test(button.textContent || '')) ||
      buttons.find((button) => /다시\s*조회/.test(button.textContent || '')) ||
      buttons.find((button) => /조회/.test(button.textContent || '')) ||
      null
    );
  }

  function findSourceStatusText(sourceCard) {
    if (!(sourceCard instanceof Element)) {
      return '';
    }

    const status = sourceCard.querySelector(
      '.efficiency-morning-meeting-auto-card__badge'
    );

    return status ? (status.textContent || '').trim() : '';
  }

  function ensureProxyButton(turbineCard, sourceCard) {
    const meta = turbineCard.querySelector(CARD_META_SELECTOR);

    if (!(meta instanceof Element)) {
      return;
    }

    let proxy = meta.querySelector(`.${PROXY_BUTTON_CLASS}`);
    const sourceButton = findSourceQueryButton(sourceCard);

    if (!(sourceButton instanceof HTMLButtonElement)) {
      if (proxy) {
        proxy.remove();
      }
      return;
    }

    if (!(proxy instanceof HTMLButtonElement)) {
      proxy = document.createElement('button');
      proxy.type = 'button';
      proxy.className = PROXY_BUTTON_CLASS;
      proxy.textContent = 'SILO 조회';
      proxy.setAttribute('aria-label', 'SILO LEVEL 개별조회');
      proxy.addEventListener('click', () => {
        const currentSource = getSourceCard();
        const currentSourceButton = findSourceQueryButton(currentSource);

        if (
          currentSourceButton instanceof HTMLButtonElement &&
          !currentSourceButton.disabled &&
          currentSourceButton.getAttribute('aria-disabled') !== 'true'
        ) {
          currentSourceButton.click();
        }
      });
      meta.appendChild(proxy);
    }

    const ariaDisabled = sourceButton.getAttribute('aria-disabled') === 'true';
    proxy.disabled = sourceButton.disabled || ariaDisabled;
    proxy.setAttribute('aria-disabled', proxy.disabled ? 'true' : 'false');

    const sourceStatus = findSourceStatusText(sourceCard);
    proxy.title = sourceStatus
      ? `SILO LEVEL 개별조회 · ${sourceStatus}`
      : 'SILO LEVEL 개별조회';
  }

  function buildMirrorBody(sourceBody) {
    const mirrorBody = document.createElement('div');
    mirrorBody.className =
      `efficiency-morning-meeting-auto-card__body ${MIRROR_BODY_CLASS}`;
    mirrorBody.setAttribute('aria-label', 'SILO LEVEL 운영정보');

    Array.from(sourceBody.children).forEach((sourceChild, index) => {
      const clone = sourceChild.cloneNode(true);

      if (!(clone instanceof Element)) {
        return;
      }

      stripIdentifiers(clone);

      clone.querySelectorAll('span').forEach((label) => {
        const text = (label.textContent || '').trim();

        if (text.startsWith('Fly Ash Silo Level')) {
          label.textContent = 'Fly Ash Silo';
        } else if (text.startsWith('Bio Storage Silo Level')) {
          label.textContent = 'Bio Storage Silo';
        }
      });

      if (index === 0) {
        clone.classList.add('is-silo-merge-start');
      }

      mirrorBody.appendChild(clone);
    });

    return mirrorBody;
  }

  function syncEyebrow(turbineCard) {
    const eyebrow = turbineCard.querySelector(
      '.efficiency-morning-meeting-auto-card__header > div:first-child > span'
    );

    if (!(eyebrow instanceof HTMLElement)) {
      return;
    }

    if (!eyebrow.dataset.turbineSiloOriginalText) {
      eyebrow.dataset.turbineSiloOriginalText =
        (eyebrow.textContent || 'TURBINE').trim();
    }

    eyebrow.textContent = 'TURBINE · OIS DATA';
  }

  function syncMergedCard() {
    const sourceCard = getSourceCard();
    const turbineCard = getTurbineCard();

    if (!(sourceCard instanceof HTMLElement)) {
      return;
    }

    if (!(turbineCard instanceof HTMLElement)) {
      return;
    }

    const sourceBody = sourceCard.querySelector(CARD_BODY_SELECTOR);
    const turbineBody = turbineCard.querySelector(
      `${CARD_BODY_SELECTOR}:not(.${MIRROR_BODY_CLASS})`
    );

    if (!(sourceBody instanceof HTMLElement)) {
      return;
    }

    if (!(turbineBody instanceof HTMLElement)) {
      return;
    }

    sourceCard.classList.add(SOURCE_HIDDEN_CLASS);
    turbineCard.classList.add(MERGED_CARD_CLASS);
    syncEyebrow(turbineCard);
    ensureProxyButton(turbineCard, sourceCard);

    const oldMirror = turbineCard.querySelector(`.${MIRROR_BODY_CLASS}`);
    const nextMirror = buildMirrorBody(sourceBody);

    if (oldMirror) {
      oldMirror.replaceWith(nextMirror);
    } else {
      turbineBody.insertAdjacentElement('afterend', nextMirror);
    }
  }

  function bindSourceCard() {
    const sourceCard = getSourceCard();

    if (sourceCard === observedSourceCard) {
      return;
    }

    if (sourceObserver) {
      sourceObserver.disconnect();
    }

    observedSourceCard = sourceCard;

    if (!(sourceCard instanceof HTMLElement)) {
      return;
    }

    sourceObserver = new MutationObserver(() => {
      queueSync();
    });

    sourceObserver.observe(sourceCard, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'class',
        'disabled',
        'hidden',
        'aria-disabled',
        'title'
      ]
    });
  }

  function observeLayout() {
    if (layoutObserver) {
      return;
    }

    const root =
      document.getElementById('efficiencyMorningMeetingAutoPreview') ||
      document.querySelector('.efficiency-morning-meeting-auto-preview') ||
      document.body;

    if (!(root instanceof HTMLElement)) {
      return;
    }

    layoutObserver = new MutationObserver((mutations) => {
      const sourceWasReplaced = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some(
          (node) =>
            node instanceof Element &&
            (node.id === SOURCE_CARD_ID || node.querySelector?.(`#${SOURCE_CARD_ID}`))
        ) ||
        Array.from(mutation.removedNodes).some(
          (node) =>
            node === observedSourceCard ||
            (node instanceof Element && node.contains?.(observedSourceCard))
        )
      );

      if (sourceWasReplaced) {
        queueSync();
      }
    });

    layoutObserver.observe(root, {
      subtree: true,
      childList: true
    });
  }

  function initialize() {
    bindSourceCard();
    syncMergedCard();
    observeLayout();

    let attempts = 0;
    const startupTimer = window.setInterval(() => {
      attempts += 1;
      queueSync();

      if (
        (observedSourceCard && getTurbineCard()) ||
        attempts >= 40
      ) {
        window.clearInterval(startupTimer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
