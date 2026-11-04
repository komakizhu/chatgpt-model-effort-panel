// ==UserScript==
// @name         ChatGPT 模型与档位
// @namespace    local.chatgpt-preference
// @version      0.5.0
// @description  通过原生控件选择模型与该模型支持的档位，并按聊天保存偏好。
// @match        https://chatgpt.com/*
// @run-at       document-end
// @inject-into  content
// @grant        none
// @noframes
// ==/UserScript==
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document && root.top === root.self) api.start(root);
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  const VERSION = '0.5.0';
  const PANEL_KEY = 'chatgpt-model-panel-v1';
  const PREFIX = 'chatgpt-model-preference-v2:';
  const LEGACY_PREFIX = 'chatgpt-56-preference-v1:';
  const PICKER = 'button[aria-label="选择 ChatGPT 模型"],button[aria-label="Select ChatGPT model"]';
  const CHOOSER_LABELS = new Set(['选择模型', 'Choose model', 'Select model']);
  const DEFAULT_MODEL_LABEL = 'GPT-5.6 Sol';
  const DEFAULT_MODEL_KEY = 'label:gpt-5.6 sol';
  const DEFAULT_EFFORT_KEY = 'effort-value:' + encodeURIComponent(DEFAULT_MODEL_KEY) + ':1';
  const LEGACY_EFFORTS = ['Low', 'Medium', 'High', 'Extra High', 'Max'];
  const DEFAULT_PREFERENCE = Object.freeze({
    modelKey: DEFAULT_MODEL_KEY,
    modelLabel: DEFAULT_MODEL_LABEL,
    effortKey: DEFAULT_EFFORT_KEY,
    effortLabel: 'Medium',
    effortState: 'value'
  });
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizedKey = value => normalize(value).toLocaleLowerCase();
  const validIndexRange = (min, max) => Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min && max - min <= 9;
  const panelModelLabel = value => /^GPT-5\.6\s+Sol$/i.test(normalize(value)) ? 'GPT-5.6' : normalize(value);

  function normalizePanelSettings(value) {
    const defaults = { collapsed: true, position: null };
    if (!value || typeof value !== 'object' || typeof value.collapsed !== 'boolean') return defaults;
    if (value.position === null) return { collapsed: value.collapsed, position: null };
    const p = value.position;
    if (!p || !Number.isFinite(p.right) || !Number.isFinite(p.bottom) || p.right < 0 || p.bottom < 0) return defaults;
    return { collapsed: value.collapsed, position: { right: p.right, bottom: p.bottom } };
  }

  function readPanelSettings(storage) {
    let raw;
    try {
      raw = storage.getItem(PANEL_KEY);
    } catch (_) {
      return { settings: normalizePanelSettings(null), available: false };
    }
    try { return { settings: raw === null ? normalizePanelSettings(null) : normalizePanelSettings(JSON.parse(raw)), available: true }; }
    catch (_) { return { settings: normalizePanelSettings(null), available: true }; }
  }

  function clampPanelPosition(position, viewport, panel) {
    const desired = position || { right: 12, bottom: 12 };
    return {
      right: Math.max(0, Math.min(desired.right, Math.max(0, viewport.width - panel.width))),
      bottom: Math.max(0, Math.min(desired.bottom, Math.max(0, viewport.height - panel.height)))
    };
  }

  function panelSummary(wanted, current) {
    const describe = preference => {
      if (!preference) return '未设置';
      const modelLabel = panelModelLabel(preference.modelLabel);
      if (preference.effortState === 'none') return modelLabel + ' · 无强度';
      if (preference.effortState === 'unknown') return modelLabel + ' · 档位未识别';
      return modelLabel + ' · ' + preference.effortLabel;
    };
    // 折叠态只显示网页当前已核对的组合，不把目标偏好或等待状态冒充成页面事实。
    return { text: current ? describe(current) : '', state: '' };
  }

  function resolveConversationPreference(saved, pending, conversation) {
    return pending || conversation || saved;
  }

  function resolveEffortLabel(chosenLabel, observedLabel) {
    const chosen = normalize(chosenLabel);
    const observed = normalize(observedLabel);
    if (!observed) return chosen;
    if (/^原生第\s*\d+\s*档$/i.test(chosen)) return observed;
    return effortKey(chosen) === effortKey(observed) ? observed : chosen;
  }

  function context(path) {
    const match = String(path || '/').match(/(?:^|\/)c\/([a-zA-Z0-9-]+)(?:\/|$)/);
    return match ? 'chat:' + match[1] : 'draft:' + String(path || '/');
  }

  function effortLabelFromStatus(value) {
    const text = normalize(value);
    const match = text.match(/^(.+?)\s*[,，]\s*(?:(?:第\s*)?\d+\s*项|item\s+\d+)/i);
    return match ? normalize(match[1]) : null;
  }

  function effortItemIndexFromStatus(value) {
    const text = normalize(value);
    const match = text.match(/(?:第\s*)?(\d+)\s*项|item\s+(\d+)/i);
    return match ? Number(match[1] || match[2]) : null;
  }

  function effortKey(label) {
    const text = normalizedKey(label);
    if (!text) return null;
    if (/^(?:low|instant|none|即时|低|无推理)$/.test(text)) return 'effort:low';
    if (/^(?:med|medium|中|中等)$/.test(text)) return 'effort:medium';
    if (/^(?:high|高)$/.test(text)) return 'effort:high';
    if (/^(?:extra\s*high|xhigh|very\s*high|极高)$/.test(text)) return 'effort:extra-high';
    if (/^(?:max|最高|最大)$/.test(text)) return 'effort:max';
    return 'label:' + text;
  }

  function effortValueKey(modelKey, value) {
    return 'effort-value:' + encodeURIComponent(normalize(modelKey)) + ':' + value;
  }

  function findEffortOption(options, preference) {
    const items = options || [];
    const pref = preference || {};
    const modelKey = normalize(pref.modelKey);
    if (!modelKey) return null;
    const prefix = 'effort-value:' + encodeURIComponent(modelKey) + ':';
    const scoped = items.filter(item => item.key.startsWith(prefix));
    const byKey = scoped.filter(item => item.key === pref.effortKey);
    if (byKey.length === 1) return byKey[0];
    if (byKey.length > 1) return null;
    const legacyKeys = new Set([normalize(pref.effortKey), effortKey(pref.effortLabel)]);
    const byLabel = scoped.filter(item => legacyKeys.has(effortKey(item.label)));
    return byLabel.length === 1 ? byLabel[0] : null;
  }

  function buildEffortOptions(modelKey, min, max, captions) {
    if (!validIndexRange(min, max)) return { kind: 'unknown', options: [], reason: '强度范围无法安全识别' };
    const options = [];
    for (let value = min; value <= max; value++) {
      const label = effortLabelFromStatus(captions && captions[value]) || '原生第 ' + (value - min + 1) + ' 档';
      options.push({ value, key: effortValueKey(modelKey, value), label });
    }
    return { kind: 'value', options, reason: '' };
  }

  function isLimitHint(value) {
    return /已达到使用限额|已达使用限额|已锁定.{0,20}访问权限|usage\s+limit\s+reached|limit\s+reached|locked.{0,40}access\s+options/i.test(normalize(value));
  }

  function createModelOption(input) {
    const data = input || {};
    const label = normalize(data.label);
    const stableId = normalize(data.stableId || '');
    const key = normalize(data.key) || (stableId ? 'id:' + normalizedKey(stableId) : label ? 'label:' + normalizedKey(label) : '');
    const category = normalize(data.category || '');
    const reason = normalize(data.reason || '');
    return {
      key,
      label,
      category,
      checked: Boolean(data.checked),
      disabled: Boolean(data.disabled || isLimitHint(reason)),
      reason: data.disabled && !reason ? '原生控件标记为不可用' : reason
    };
  }

  function isManualNativeAction(event, kind) {
    if (!event || !event.isTrusted) return false;
    if (kind === 'model') {
      return event.type === 'click' || event.type === 'pointerdown' ||
        (event.type === 'keydown' && ['Enter', ' ', 'Spacebar'].includes(event.key));
    }
    if (kind === 'effort') {
      return event.type === 'pointerdown' ||
        (event.type === 'keydown' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key));
    }
    return false;
  }

  function findModel(models, preference) {
    const pref = preference || {};
    const byKey = (models || []).filter(item => item.key === pref.modelKey);
    if (byKey.length === 1) return byKey[0];
    if (byKey.length > 1) return null;
    const wanted = normalizedKey(pref.modelLabel);
    if (!wanted) return null;
    const byLabel = (models || []).filter(item => normalizedKey(item.label) === wanted);
    return byLabel.length === 1 ? byLabel[0] : null;
  }

  function normalizePreference(value) {
    if (!value || typeof value !== 'object') return null;
    const modelKey = normalize(value.modelKey);
    const modelLabel = normalize(value.modelLabel);
    const state = value.effortState;
    if (!modelKey || !modelLabel || !['value', 'none', 'unknown'].includes(state)) return null;
    if (state === 'value' && (!normalize(value.effortKey) || !normalize(value.effortLabel))) return null;
    return {
      modelKey,
      modelLabel,
      effortKey: state === 'value' ? normalize(value.effortKey) : null,
      effortLabel: state === 'value' ? normalize(value.effortLabel) : '',
      effortState: state
    };
  }

  class Preferences {
    constructor(local, session) {
      this.local = local;
      this.session = session;
    }
    storage(key) { return String(key).startsWith('draft:') ? this.session : this.local; }
    readRaw(storage, key, prefix) {
      try { return storage.getItem(prefix + key); } catch (_) { return null; }
    }
    readStorage(storage, key, prefix) {
      const raw = this.readRaw(storage, key, prefix);
      if (raw === null) return null;
      try { return normalizePreference(JSON.parse(raw)); } catch (_) { return null; }
    }
    readDefault() { return this.readStorage(this.local, 'default', PREFIX) || { ...DEFAULT_PREFERENCE }; }
    setDefault(value) {
      const preference = normalizePreference(value);
      if (!preference || preference.effortState === 'unknown') throw new Error('只有已确认的模型与档位可以设为默认');
      this.local.setItem(PREFIX + 'default', JSON.stringify(preference));
      return preference;
    }
    read(key) { return this.readStorage(this.storage(key), key, PREFIX); }
    readLegacy(key) {
      const storage = this.storage(key);
      const raw = this.readRaw(storage, key, LEGACY_PREFIX);
      if (raw === null) return null;
      try {
        const item = JSON.parse(raw);
        const mapped = LEGACY_EFFORTS[item.level];
        if (!mapped) return null;
        return {
          modelKey: DEFAULT_MODEL_KEY,
          modelLabel: DEFAULT_MODEL_LABEL,
          effortKey: effortValueKey(DEFAULT_MODEL_KEY, item.level),
          effortLabel: mapped,
          effortState: 'value'
        };
      } catch (_) { return null; }
    }
    ensure(key) {
      const stored = this.read(key);
      if (stored) return stored;
      const inherited = this.readLegacy(key) || this.readDefault();
      this.save(key, inherited);
      return inherited;
    }
    save(key, value) {
      const preference = normalizePreference(value);
      if (!preference) throw new Error('模型偏好格式无法识别');
      this.storage(key).setItem(PREFIX + key, JSON.stringify(preference));
      return preference;
    }
    resetDraft(key) {
      if (!String(key).startsWith('draft:')) return;
      const storage = this.session;
      storage.removeItem(PREFIX + key);
      storage.removeItem(LEGACY_PREFIX + key);
    }
    migrate(from, to, pending, now = Date.now()) {
      if (!String(from).startsWith('draft:') || !String(to).startsWith('chat:')) return;
      if (!pending || pending.from !== from || now - pending.time < 0 || now - pending.time >= 30000) return;
      const preference = this.read(from);
      if (preference && !this.read(to)) this.save(to, preference);
      this.resetDraft(from);
    }
  }

  function start(win) {
    const doc = win.document;
    if (doc.documentElement.dataset.chatgptModelPreferenceVersion === VERSION) return;
    doc.documentElement.dataset.chatgptModelPreferenceVersion = VERSION;
    const prefs = new Preferences(win.localStorage, win.sessionStorage);
    const panelStorage = readPanelSettings(win.localStorage);
    let panelSettings = panelStorage.settings, panelStorageAvailable = panelStorage.available;
    let drag = null, positionFrame = 0;
    let key = context(win.location.pathname), timer = 0, captureTimer = 0;
    let serial = 0, lastInput = 0, pointerDown = false, composing = false;
    let working = false, ownedMenu = false, userOwnsMenu = false;
    let pendingChoice = null, pendingNativeCapture = false;
    let conversationPreference = null;
    let verified = '', blocked = '', lastObservedButton = '', statusText = '正在读取原生模型选项';
    let catalog = [], effortOptions = [], effortModelKey = '', confirmedPreference = null;
    let panelUi = null, pendingSend = null;

    const visible = element => !!element && element.isConnected && element.getClientRects().length > 0 &&
      win.getComputedStyle(element).visibility !== 'hidden' && win.getComputedStyle(element).display !== 'none';
    const picker = () => [...doc.querySelectorAll(PICKER)].find(visible);
    const menus = () => [...doc.querySelectorAll('[role="menu"]')].filter(visible);
    const slider = () => menus().map(menu => menu.querySelector('[role="slider"]')).find(visible) || null;
    const stopButton = () => doc.querySelector('button[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="停止流式传输"]');
    const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
    const currentPath = () => win.location.pathname;
    const selectedIn = options => options.find(option => option.checked) || null;

    function status(value) {
      statusText = value;
      if (panelUi) renderPanel();
      const button = picker();
      if (button) {
        button.setAttribute('data-chatgpt-preference-status', value);
        button.title = '模型偏好：' + value;
      }
    }

    function modelUnavailableReason(element) {
      const directDisabled = element.matches(':disabled,[aria-disabled="true"],[data-disabled="true"]') ||
        element.getAttribute('data-state') === 'disabled';
      if (directDisabled) return normalize(element.getAttribute('aria-description') || element.getAttribute('title')) || '原生控件标记为不可用';
      const parent = element.parentElement;
      if (!parent) return '';
      const siblings = [...parent.children];
      const index = siblings.indexOf(element);
      const hints = [];
      for (let i = index - 1; i >= 0; i--) {
        const sibling = siblings[i];
        if (sibling.matches('[role="menuitemradio"]')) break;
        if (sibling.matches('.sr-only,[role="status"],[aria-live]')) {
          const text = normalize(sibling.textContent);
          if (text) hints.unshift(text);
        }
      }
      const reason = hints.join(' ');
      return isLimitHint(reason) ? reason : '';
    }

    function modelCategory(element) {
      const group = element.closest('[role="group"]');
      if (!group) return '';
      const direct = normalize(group.getAttribute('aria-label'));
      if (direct) return direct;
      const labelledBy = normalize(group.getAttribute('aria-labelledby'));
      if (!labelledBy) return '';
      return labelledBy.split(/\s+/)
        .map(id => doc.getElementById(id))
        .filter(Boolean)
        .map(node => normalize(node.textContent))
        .filter(Boolean)
        .join(' ');
    }

    function modelInfo(element) {
      const labelNode = element.querySelector('[data-menu-row-content]');
      const label = normalize(element.getAttribute('aria-label') || (labelNode && labelNode.textContent) || element.innerText || element.textContent);
      const stableId = element.getAttribute('data-model-id') || element.getAttribute('data-model') ||
        element.getAttribute('value') || element.getAttribute('data-testid') || '';
      const reason = modelUnavailableReason(element);
      return createModelOption({
        label,
        stableId,
        category: modelCategory(element),
        checked: element.getAttribute('aria-checked') === 'true' || element.getAttribute('data-state') === 'checked',
        disabled: !!reason,
        reason
      });
    }

    function modelElements() {
      return menus().flatMap(menu => [...menu.querySelectorAll('[role="menuitemradio"]')].filter(visible));
    }

    function isChooser(element) {
      const label = normalize(element.getAttribute('aria-label') || element.innerText || element.textContent);
      return CHOOSER_LABELS.has(label);
    }

    function chooser() {
      return menus().flatMap(menu => [...menu.querySelectorAll('[role="menuitem"]')])
        .find(element => visible(element) && isChooser(element));
    }

    function isBusy() {
      return doc.readyState !== 'complete' || doc.hidden || pointerDown || composing ||
        Date.now() - lastInput < 1300 || !!stopButton() ||
        (menus().length > 0 && !ownedMenu);
    }

    function cancellationCheck(epoch, routeKey) {
      if (serial !== epoch || context(currentPath()) !== routeKey || doc.hidden) {
        throw new Error('用户开始操作或切换了聊天，脚本已让出控件');
      }
    }

    async function waitFor(fn, check, message = '原生控件没有按预期更新') {
      for (let i = 0; i < 30; i++) {
        check();
        const value = fn();
        if (value) return value;
        await delay(70);
      }
      throw new Error(message);
    }

    async function closeOwnedMenus() {
      if (!ownedMenu || userOwnsMenu) return;
      for (let attempt = 0; attempt < 2 && menus().length; attempt++) {
        const outside = doc.createElement('span');
        outside.hidden = true;
        doc.documentElement.append(outside);
        try {
          outside.dispatchEvent(new win.PointerEvent('pointerdown', {
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
            buttons: 1, bubbles: true, cancelable: true, composed: true
          }));
          await delay(70);
        } finally { outside.remove(); }
      }
      if (!menus().length) ownedMenu = false;
    }

    async function openParentMenu(check) {
      if (menus().length) await closeOwnedMenus();
      check();
      const button = picker();
      if (!button || button.matches(':disabled,[aria-disabled="true"]')) throw new Error('找不到可用的原生模型菜单');
      button.click();
      ownedMenu = true;
      await waitFor(() => chooser() || slider(), check, '模型菜单未打开');
      return button;
    }

    async function openModelOptions(check) {
      await openParentMenu(check);
      check();
      const modelChooser = chooser();
      if (!modelChooser) throw new Error('模型列表入口无法识别');
      modelChooser.click();
      await waitFor(() => modelElements().length > 0, check, '原生模型列表为空或无法读取');
      const elements = modelElements();
      const items = elements.map(modelInfo).filter(item => item.label && item.key);
      if (!items.length) throw new Error('模型名称无法识别');
      const counts = new Map();
      for (const item of items) counts.set(item.key, (counts.get(item.key) || 0) + 1);
      if ([...counts.values()].some(count => count > 1)) throw new Error('模型列表存在重复标识，未猜测目标模型');
      catalog = items;
      renderPanel();
      return { items, elements, selected: selectedIn(items) };
    }

    function readEffortStatus(menu) {
      const statusNode = menu && menu.querySelector('[role="status"][aria-live], [role="status"]');
      const raw = normalize(statusNode && statusNode.textContent);
      return { raw, label: effortLabelFromStatus(raw), itemIndex: effortItemIndexFromStatus(raw) };
    }

    function readEffortCaption(menu) {
      return readEffortStatus(menu).label;
    }

    function noEffortIsExplicit(menu) {
      const text = normalize(menu && menu.textContent);
      return /不提供思考强度|不支持思考强度|无需思考强度|no\s+(?:reasoning\s+)?effort|effort\s+not\s+supported|no\s+thinking\s+control/i.test(text);
    }

    function currentEffort() {
      const control = slider();
      if (!control) return { state: 'missing', control: null, value: null, label: null, statusText: '', itemIndex: null, min: null, max: null };
      const menu = control.closest('[role="menu"]');
      const min = Number(control.getAttribute('aria-valuemin'));
      const max = Number(control.getAttribute('aria-valuemax'));
      const value = Number(control.getAttribute('aria-valuenow'));
      const status = readEffortStatus(menu);
      const valueText = normalize(control.getAttribute('aria-valuetext'));
      const accessibleLabel = /[A-Za-z\u4e00-\u9fff]/.test(valueText) ? valueText : '';
      return {
        state: validIndexRange(min, max) && Number.isInteger(value) && value >= min && value <= max ? 'range' : 'unknown',
        control,
        menu,
        value,
        label: accessibleLabel || status.label,
        statusText: accessibleLabel ? 'aria:' + accessibleLabel : status.raw,
        itemIndex: status.itemIndex,
        accessibleLabel,
        min,
        max
      };
    }

    async function waitForEffortCaption(state, previousStatus, previousLabel, fallback, check) {
      let current = state;
      for (let i = 0; i < 12; i++) {
        check();
        const expectedItem = current.state === 'range' ? current.value - current.min + 1 : null;
        const itemMatches = current.itemIndex === null || current.itemIndex === expectedItem;
        if (current.label && itemMatches && ((!previousStatus && !previousLabel) || current.statusText !== previousStatus || current.label !== previousLabel)) {
          return current.label;
        }
        await delay(45);
        current = currentEffort();
      }
      return fallback || '';
    }

    async function moveSliderTo(target, check) {
      let state = currentEffort();
      if (state.state !== 'range') throw new Error('强度滑杆范围无法确认');
      if (!Number.isInteger(target) || target < state.min || target > state.max) throw new Error('目标档位超出原生范围');
      let attempts = 0;
      while (state.value !== target && attempts++ < 10) {
        check();
        const before = state.value;
        state.control.focus({ preventScroll: true });
        const keyName = before < target ? 'ArrowRight' : 'ArrowLeft';
        state.control.dispatchEvent(new win.KeyboardEvent('keydown', { key: keyName, code: keyName, bubbles: true, cancelable: true }));
        await waitFor(() => {
          const next = currentEffort();
          return next.state === 'range' && next.value !== before ? next : null;
        }, check, '强度档位没有变化');
        state = currentEffort();
      }
      if (state.value !== target) throw new Error('无法定位目标档位');
      return state;
    }

    async function discoverEfforts(check, modelKey) {
      const initial = currentEffort();
      if (initial.state === 'missing') {
        if (noEffortIsExplicit(menus()[0])) return { kind: 'none', options: [], current: null };
        return { kind: 'unknown', options: [], current: null, reason: '当前模型没有可识别的强度控件' };
      }
      if (initial.state !== 'range' || initial.max - initial.min > 9) {
        return { kind: 'unknown', options: [], current: null, reason: '强度范围无法安全识别' };
      }
      const captions = Object.create(null);
      let originalValue = initial.value;
      captions[initial.value] = initial.label || '';
      let previousStatus = initial.statusText;
      let previousLabel = initial.label || '';
      let interrupted = false;
      let probeFailed = false;
      try {
        let current = initial.value;
        while (current > initial.min) {
          const next = await moveSliderTo(current - 1, check);
          current = next.value;
          captions[current] = await waitForEffortCaption(next, previousStatus, previousLabel, '', check);
          const observed = currentEffort();
          previousStatus = observed.statusText || previousStatus;
          previousLabel = observed.label || previousLabel;
        }
        while (current < initial.max) {
          const next = await moveSliderTo(current + 1, check);
          current = next.value;
          captions[current] = await waitForEffortCaption(next, previousStatus, previousLabel, '', check);
          const observed = currentEffort();
          previousStatus = observed.statusText || previousStatus;
          previousLabel = observed.label || previousLabel;
        }
      } catch (error) {
        try { check(); } catch (_) { interrupted = true; }
        if (interrupted) throw error;
        probeFailed = true;
      } finally {
        if (!interrupted) {
          const now = currentEffort();
          if (now.state === 'range' && now.value !== originalValue) {
            try { await moveSliderTo(originalValue, check); } catch (error) {
              try { check(); } catch (_) { interrupted = true; }
              if (!interrupted) throw error;
            }
          }
        }
      }
      if (interrupted) return { kind: 'unknown', options: [], current: null, reason: '探测期间用户开始操作' };
      const map = buildEffortOptions(modelKey, initial.min, initial.max, captions);
      if (map.kind !== 'value') return { kind: 'unknown', options: [], current: null, reason: map.reason };
      const current = map.options.find(option => option.value === originalValue) || null;
      return {
        kind: 'value',
        options: map.options,
        current,
        reason: probeFailed ? '部分档位名称不可读取，面板会按原生档位序号显示' : ''
      };
    }

    async function readCurrentPreferenceFromNative(check, nativeModelChange = false) {
      const modelState = await openModelOptions(check);
      const selected = modelState.selected;
      if (!selected) throw new Error('当前模型没有唯一的原生勾选项');
      if (selected.disabled) return { unavailable: true, model: selected, reason: selected.reason || '当前模型不可用' };
      await closeOwnedMenus();
      await openParentMenu(check);
      const effortState = await discoverEfforts(check, selected.key);
      if (effortState.kind === 'none') {
        return {
          unavailable: false,
          preference: { modelKey: selected.key, modelLabel: selected.label, effortKey: null, effortLabel: '', effortState: 'none' },
          effortState
        };
      }
      if (effortState.kind === 'unknown') {
        return {
          unavailable: false,
          preference: { modelKey: selected.key, modelLabel: selected.label, effortKey: null, effortLabel: '', effortState: 'unknown' },
          effortState
        };
      }
      const current = effortState.current;
      return {
        unavailable: false,
        preference: {
          modelKey: selected.key,
          modelLabel: selected.label,
          effortKey: current.key,
          effortLabel: current.label,
          effortState: 'value'
        },
        effortState
      };
    }

    function updateEffortUi(modelKey, result) {
      effortModelKey = modelKey;
      effortOptions = result.kind === 'value' ? result.options : [];
      renderPanel();
    }

    async function readCatalogOnly(check) {
      const state = await openModelOptions(check);
      await closeOwnedMenus();
      return state;
    }

    function targetSignature(preference, buttonText) {
      return [key, preference.modelKey, preference.effortKey || preference.effortState, normalize(buttonText)].join('|');
    }

    function rememberConversationPreference(preference) {
      const normalized = normalizePreference(preference);
      if (normalized) conversationPreference = { key, preference: normalized };
    }

    function savedConversationPreference() {
      return conversationPreference && conversationPreference.key === key ? conversationPreference.preference : null;
    }

    function desiredConversationPreference() {
      return resolveConversationPreference(prefs.ensure(key), pendingChoice, savedConversationPreference());
    }

    function appendEffortOption(select, label, value = '', disabled = true) {
      const option = doc.createElement('option');
      option.textContent = label;
      option.value = value;
      option.disabled = disabled;
      option.selected = disabled;
      select.append(option);
    }

    function chooseModel(item) {
      if (!item || item.disabled) return;
      route();
      pendingChoice = { modelKey: item.key, modelLabel: item.label, effortKey: null, effortLabel: '', effortState: 'unknown' };
      rememberConversationPreference(pendingChoice);
      verified = ''; blocked = '';
      status('等待空闲后应用所选模型');
      schedule(1500);
    }

    function chooseEffort(item, value) {
      const selected = item && !item.disabled ? item : null;
      const chosenEffort = effortOptions.find(option => option.key === value);
      if (!selected || !chosenEffort || effortModelKey !== selected.key) {
        status('当前模型的档位尚未确认');
        return;
      }
      route();
      pendingChoice = {
        modelKey: selected.key,
        modelLabel: selected.label,
        effortKey: chosenEffort.key,
        effortLabel: chosenEffort.label,
        effortState: 'value'
      };
      rememberConversationPreference(pendingChoice);
      verified = ''; blocked = '';
      status('等待空闲后应用所选档位');
      schedule(1500);
    }

    function renderModelRows(wanted, resolved) {
      const models = catalog.map(item => ({ ...item }));
      if (!models.some(item => item.key === wanted.modelKey || normalizedKey(item.label) === normalizedKey(wanted.modelLabel))) {
        models.unshift(createModelOption({ label: wanted.modelLabel, key: wanted.modelKey, disabled: true, reason: '当前原生菜单没有此模型' }));
      }
      const selectedKey = resolved ? resolved.key : wanted.modelKey;
      const catalogKey = models.map(item => [item.key, item.label, item.category, item.disabled, item.reason].join(':')).join('|');
      if (panelUi.catalogKey !== catalogKey) {
        panelUi.modelList.replaceChildren();
        panelUi.modelRows = new Map();
        for (const item of models) {
          const row = doc.createElement('div');
          row.className = 'model-row';
          row.dataset.modelKey = item.key;
          const modelButton = doc.createElement('button');
          modelButton.className = 'model-choice';
          modelButton.type = 'button';
          modelButton.textContent = panelModelLabel(item.label);
          modelButton.title = item.reason || item.label;
          modelButton.disabled = item.disabled;
          modelButton.dataset.chatgptPanelControl = '';
          modelButton.addEventListener('click', event => {
            if (!event.isTrusted) return;
            chooseModel(item);
          });
          const effort = doc.createElement('select');
          effort.className = 'effort-choice';
          effort.setAttribute('aria-label', item.label + ' 强度');
          effort.dataset.chatgptPanelControl = '';
          effort.addEventListener('change', event => {
            if (!event.isTrusted) return;
            chooseEffort(item, effort.value);
          });
          row.append(modelButton, effort);
          panelUi.modelList.append(row);
          panelUi.modelRows.set(item.key, { item, row, modelButton, effort });
        }
        panelUi.catalogKey = catalogKey;
      }
      for (const { item, row, modelButton, effort } of panelUi.modelRows.values()) {
        const isSelected = item.key === selectedKey;
        row.dataset.selected = String(isSelected);
        row.setAttribute('aria-disabled', String(item.disabled));
        modelButton.setAttribute('aria-pressed', String(isSelected));
        effort.replaceChildren();
        const canReadEffort = isSelected && !item.disabled && wanted.effortState !== 'unknown' &&
          effortModelKey === item.key && effortOptions.length > 0;
        if (item.disabled) {
          appendEffortOption(effort, '不可用');
          effort.disabled = true;
        } else if (isSelected && wanted.effortState === 'none') {
          appendEffortOption(effort, '无强度设置');
          effort.disabled = true;
        } else if (!canReadEffort) {
          appendEffortOption(effort, '选择模型后读取强度');
          effort.disabled = true;
        } else {
          for (const option of effortOptions) {
            const effortOption = doc.createElement('option');
            effortOption.value = option.key;
            effortOption.textContent = option.label;
            effort.append(effortOption);
          }
          effort.disabled = false;
          if (wanted.effortKey && effortOptions.some(option => option.key === wanted.effortKey)) {
            effort.value = wanted.effortKey;
          }
        }
      }
    }

    function renderPanel() {
      if (!panelUi) return;
      const saved = desiredConversationPreference();
      const wanted = pendingChoice || saved;
      const resolved = findModel(catalog, wanted);
      renderModelRows(wanted, resolved);
      const current = confirmedPreference;
      panelUi.status.textContent = statusText;
      panelUi.saveDefault.disabled = !current || current.effortState === 'unknown' || !!blocked || statusText !== '已确认';
      const short = panelSummary(wanted, current);
      panelUi.short.textContent = short.text || '…';
      panelUi.short.title = short.text;
      panelUi.short.setAttribute('aria-label', short.text);
      panelUi.storageNote.hidden = panelStorageAvailable;
    }

    function savePanelSettings() {
      try {
        win.localStorage.setItem(PANEL_KEY, JSON.stringify(panelSettings));
        panelStorageAvailable = true;
      } catch (_) { panelStorageAvailable = false; }
      if (panelUi) panelUi.storageNote.hidden = panelStorageAvailable;
    }

    function applyPanelPosition() {
      if (!panelUi || !panelUi.host.isConnected) return;
      const rect = panelUi.host.getBoundingClientRect();
      const actual = clampPanelPosition(drag?.position || panelSettings.position,
        { width: win.innerWidth, height: win.innerHeight }, { width: rect.width, height: rect.height });
      panelUi.host.style.right = actual.right + 'px';
      panelUi.host.style.bottom = actual.bottom + 'px';
    }

    function queuePanelPosition() {
      win.cancelAnimationFrame(positionFrame);
      positionFrame = win.requestAnimationFrame(applyPanelPosition);
    }

    function finishDrag(cancelled) {
      if (!drag) return;
      const previous = drag;
      drag = null;
      pointerDown = false;
      if (!cancelled && previous.moved) {
        panelSettings.position = previous.position;
        savePanelSettings();
      }
      panelUi.panel.classList.remove('is-dragging');
      if (panelUi.dragSurface.hasPointerCapture?.(previous.pointerId)) {
        panelUi.dragSurface.releasePointerCapture(previous.pointerId);
      }
      applyPanelPosition();
      lastInput = Date.now();
      schedule(1450);
    }

    function setPanelCollapsed(collapsed) {
      if (collapsed && panelUi.body.contains(panelUi.shadow.activeElement)) panelUi.toggle.focus({ preventScroll: true });
      panelSettings.collapsed = collapsed;
      panelUi.body.hidden = collapsed;
      panelUi.toggle.textContent = collapsed ? '▴' : '▾';
      panelUi.toggle.setAttribute('aria-label', collapsed ? '展开模型与档位面板' : '折叠模型与档位面板');
      panelUi.toggle.setAttribute('aria-expanded', String(!collapsed));
      savePanelSettings();
      queuePanelPosition();
    }

    function setupPanelLayout() {
      const { host, panel, keyboardSurface, toggle, body } = panelUi;
      body.hidden = panelSettings.collapsed;
      toggle.textContent = panelSettings.collapsed ? '▴' : '▾';
      toggle.setAttribute('aria-label', panelSettings.collapsed ? '展开模型与档位面板' : '折叠模型与档位面板');
      toggle.setAttribute('aria-expanded', String(!panelSettings.collapsed));
      toggle.addEventListener('click', () => setPanelCollapsed(!panelSettings.collapsed));
      panelUi.resetPosition.addEventListener('click', () => {
        panelSettings.position = null;
        savePanelSettings();
        applyPanelPosition();
      });
      panel.addEventListener('pointerdown', event => {
        if (event.button !== 0 || drag) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        if (path.some(item => item && item.nodeType === 1 && item.matches?.('button,select,a,input,textarea,[data-chatgpt-panel-control]'))) return;
        const rect = host.getBoundingClientRect();
        drag = {
          pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          start: { right: Math.max(0, win.innerWidth - rect.right), bottom: Math.max(0, win.innerHeight - rect.bottom) },
          position: null, moved: false
        };
        panel.classList.add('is-dragging');
        try { panel.setPointerCapture(event.pointerId); }
        catch (_) { finishDrag(true); return; }
        event.preventDefault();
      });
      panel.addEventListener('pointermove', event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) <= 5) return;
        drag.moved = true;
        const rect = host.getBoundingClientRect();
        drag.position = clampPanelPosition({ right: drag.start.right - dx, bottom: drag.start.bottom - dy },
          { width: win.innerWidth, height: win.innerHeight }, { width: rect.width, height: rect.height });
        applyPanelPosition();
      });
      panel.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) finishDrag(false); });
      panel.addEventListener('pointercancel', event => { if (drag?.pointerId === event.pointerId) finishDrag(true); });
      panel.addEventListener('lostpointercapture', event => { if (drag?.pointerId === event.pointerId) finishDrag(true); });
      keyboardSurface.addEventListener('keydown', event => {
        if (event.key === 'Escape' && drag) { event.preventDefault(); finishDrag(true); return; }
        const delta = event.shiftKey ? 40 : 10;
        const moves = { ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
        if (!moves[event.key]) return;
        event.preventDefault();
        const rect = host.getBoundingClientRect();
        const [dx, dy] = moves[event.key];
        panelSettings.position = clampPanelPosition(
          { right: win.innerWidth - rect.right + dx, bottom: win.innerHeight - rect.bottom + dy },
          { width: win.innerWidth, height: win.innerHeight }, { width: rect.width, height: rect.height });
        savePanelSettings();
        applyPanelPosition();
      });
      win.addEventListener('resize', queuePanelPosition);
      win.addEventListener('blur', () => finishDrag(true));
      doc.addEventListener('keydown', event => {
        if (event.key === 'Escape' && drag) { event.preventDefault(); finishDrag(true); }
      }, true);
      if (win.ResizeObserver) new win.ResizeObserver(queuePanelPosition).observe(panel);
      applyPanelPosition();
    }

    function mountPanel() {
      if (panelUi) {
        if (!panelUi.host.isConnected && doc.body) { doc.body.append(panelUi.host); queuePanelPosition(); }
        return;
      }
      if (!doc.body || !doc.createElement || !win.Element?.prototype?.attachShadow) {
        win.setTimeout(mountPanel, 100);
        return;
      }
      const host = doc.createElement('div');
      host.dataset.chatgptModelPanel = VERSION;
      const shadow = host.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = `
        :host { all: initial; position: fixed; right: 10px; bottom: 10px; z-index: 2147483647; display: block; width: min(224px, calc(100vw - 16px)); color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        .panel { width: 100%; border: 1px solid rgba(255,255,255,.14); border-radius: 13px; background: rgba(25,28,34,.96); color: #f4f5f7; box-shadow: 0 8px 26px rgba(0,0,0,.28); backdrop-filter: blur(16px); cursor: grab; touch-action: manipulation; }
        .panel.is-dragging { cursor: grabbing; user-select: none; touch-action: none; }
        .header { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 36px; padding: 3px 5px 3px 11px; border-radius: 12px 12px 0 0; }
        .short { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #f5f7fb; font-size: 12px; font-weight: 600; letter-spacing: .01em; }
        .toggle { flex: none; width: 30px; height: 30px; min-height: 30px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: #c9d5e4; font-size: 17px; font-weight: 700; line-height: 1; }
        .toggle:hover:not(:disabled) { background: rgba(137,183,255,.12); }
        .body { max-height: calc(100vh - 65px); overflow-y: auto; padding: 7px 8px 8px; border-top: 1px solid rgba(255,255,255,.08); }
        .body[hidden] { display: none; }
        .model-list { display: grid; gap: 6px; }
        .model-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(88px, .9fr); gap: 5px; align-items: center; min-width: 0; padding: 4px; border: 1px solid rgba(255,255,255,.10); border-radius: 10px; background: rgba(39,43,51,.76); transition: border-color 160ms ease, background 160ms ease; }
        .model-row[data-selected="true"] { border-color: rgba(130,184,255,.72); background: rgba(53,72,98,.62); }
        .model-choice, .effort-choice, .tool { min-height: 32px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #f4f5f7; font: inherit; font-size: 12px; }
        .model-choice { min-width: 0; overflow: hidden; padding: 0 7px; text-align: left; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; cursor: pointer; }
        .model-row[data-selected="true"] .model-choice::before { content: '✓'; display: inline-block; margin-right: 5px; color: #a9d0ff; font-size: 11px; }
        .effort-choice { display: block; width: 100%; min-width: 0; padding: 0 7px; background: rgba(16,19,24,.56); text-overflow: ellipsis; cursor: pointer; }
        .effort-choice:disabled, .model-choice:disabled { opacity: .5; cursor: default; }
        option { background: #262a32; color: #f4f5f7; }
        option:disabled { color: #999; }
        button:hover:not(:disabled), button:focus-visible, select:focus-visible, .header:focus-visible { border-color: #83b8ff; outline: 2px solid #83b8ff; outline-offset: 1px; }
        button:disabled, select:disabled { cursor: default; }
        .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
        .actions { display: flex; justify-content: flex-end; gap: 4px; margin-top: 5px; }
        .tool { width: 28px; min-height: 28px; padding: 0; color: #aeb9c8; font-size: 14px; line-height: 1; cursor: pointer; }
        .tool:hover:not(:disabled) { background: rgba(137,183,255,.12); color: #eaf3ff; }
        .storage-note { margin: 5px 0 0; color: #ffca84; font-size: 10px; }
      `;
      const panel = doc.createElement('section'); panel.className = 'panel'; panel.setAttribute('aria-label', 'ChatGPT 模型与档位');
      const header = doc.createElement('div'); header.className = 'header';
      header.tabIndex = 0;
      header.setAttribute('role', 'group'); header.setAttribute('aria-label', '移动面板，使用方向键，按住 Shift 可加快移动');
      const short = doc.createElement('span'); short.className = 'short'; short.setAttribute('aria-live', 'polite');
      const toggle = doc.createElement('button'); toggle.className = 'toggle'; toggle.type = 'button'; toggle.dataset.chatgptPanelLayout = '';
      toggle.setAttribute('aria-controls', 'chatgpt-panel-body');
      toggle.title = '展开或折叠模型面板';
      header.append(short, toggle);
      const body = doc.createElement('div'); body.className = 'body'; body.id = 'chatgpt-panel-body';
      const statusNode = doc.createElement('p'); statusNode.className = 'visually-hidden'; statusNode.setAttribute('aria-live', 'polite');
      const modelList = doc.createElement('div'); modelList.className = 'model-list';
      const actions = doc.createElement('div'); actions.className = 'actions';
      const saveDefault = doc.createElement('button'); saveDefault.className = 'tool'; saveDefault.type = 'button'; saveDefault.textContent = '☆'; saveDefault.title = '设为新聊天默认'; saveDefault.setAttribute('aria-label', '设为新聊天默认');
      const refresh = doc.createElement('button'); refresh.className = 'tool'; refresh.type = 'button'; refresh.textContent = '↻'; refresh.title = '重新读取原生控件'; refresh.setAttribute('aria-label', '重新读取原生控件');
      const resetPosition = doc.createElement('button'); resetPosition.className = 'tool'; resetPosition.type = 'button'; resetPosition.textContent = '⌖'; resetPosition.title = '回到右下角'; resetPosition.setAttribute('aria-label', '回到右下角'); resetPosition.dataset.chatgptPanelLayout = '';
      const storageNote = doc.createElement('p'); storageNote.className = 'storage-note'; storageNote.textContent = '无法保存面板位置和折叠状态';
      saveDefault.dataset.chatgptPanelControl = '';
      refresh.dataset.chatgptPanelControl = '';
      actions.append(resetPosition, saveDefault, refresh);
      body.append(statusNode, modelList, storageNote, actions);
      panel.append(header, body);
      shadow.append(style, panel);
      doc.body.append(host);
      panelUi = { host, shadow, panel, dragSurface: panel, body, keyboardSurface: header, short, toggle, storageNote, resetPosition, modelList, modelRows: new Map(), status: statusNode, saveDefault, refresh, catalogKey: '' };
      setupPanelLayout();
      saveDefault.addEventListener('click', event => {
        if (!event.isTrusted || !confirmedPreference || statusText !== '已确认' || confirmedPreference.effortState === 'unknown') return;
        try {
          prefs.setDefault(confirmedPreference);
          statusText = '已保存为新聊天默认';
          renderPanel();
        } catch (error) { status(error.message); }
      });
      refresh.addEventListener('click', event => {
        if (!event.isTrusted) return;
        verified = ''; blocked = ''; pendingChoice = null; pendingNativeCapture = false;
        status('等待空闲后重新读取'); schedule(1500);
      });
      renderPanel();
    }

    function schedule(ms = 450) {
      if (working) return;
      win.clearTimeout(timer);
      const delayMs = Math.max(ms, Math.max(0, 1300 - (Date.now() - lastInput)));
      timer = win.setTimeout(() => reconcile().catch(error => {
        console.warn('[ChatGPT model preference]', error.message);
        status('读取失败：' + error.message);
      }), delayMs);
    }

    function queueNativeCapture() {
      pendingNativeCapture = true;
      pendingChoice = null;
      verified = ''; blocked = '';
      win.clearTimeout(captureTimer);
      captureTimer = win.setTimeout(() => schedule(0), 1450);
    }

    function route() {
      const next = context(currentPath());
      if (next === key) return;
      prefs.migrate(key, next, pendingSend, Date.now());
      key = next;
      pendingSend = null;
      pendingChoice = null;
      pendingNativeCapture = false;
      conversationPreference = null;
      confirmedPreference = null;
      verified = ''; blocked = ''; lastObservedButton = '';
      effortOptions = []; effortModelKey = '';
      prefs.ensure(key);
      renderPanel();
    }

    function elementsInPath(event) {
      return typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    }

    function pathFind(path, selector) {
      return path.find(item => item && item.nodeType === 1 && item.matches && item.matches(selector));
    }

    function interaction(event) {
      if (!event.isTrusted) return;
      route();
      serial++;
      const path = elementsInPath(event);
      const insideNativeMenu = !!pathFind(path, '[role="menu"]');
      const modelItem = pathFind(path, '[role="menuitemradio"]');
      const strength = pathFind(path, '[role="slider"]');
      const panelControl = pathFind(path, '[data-chatgpt-panel-control]');
      if (working && (insideNativeMenu || panelControl || pathFind(path, PICKER))) userOwnsMenu = true;
      lastInput = Date.now();
      if (event.type === 'pointerdown') pointerDown = true;
      if (event.type === 'pointerup' || event.type === 'pointercancel') pointerDown = false;
      const modelActivation = !!modelItem && isManualNativeAction(event, 'model');
      const effortActivation = !!strength && isManualNativeAction(event, 'effort');
      const resetItem = pathFind(path, '[role="menuitem"][aria-label="重置为默认"],[role="menuitem"][aria-label="Reset to default"]');
      if (modelActivation || effortActivation || (insideNativeMenu && event.type === 'click' && !!resetItem)) queueNativeCapture();
      const control = pathFind(path, 'button,a');
      const sendClick = event.type === 'click' && control && (
        control.getAttribute('data-testid') === 'send-button' ||
        /^(?:发送|发送提示|Send prompt|Send message)$/i.test(normalize(control.getAttribute('aria-label')))
      );
      const composer = pathFind(path, 'textarea,[contenteditable="true"]');
      const sendEnter = event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey &&
        !event.metaKey && !event.altKey && !event.isComposing && !composing && !!composer;
      if (key.startsWith('draft:') && (sendClick || sendEnter)) pendingSend = { from: key, time: Date.now() };
      if (event.type === 'click' && control) {
        if (control.matches('a')) pendingSend = null;
        if (/^(?:新聊天|New chat)$/i.test(normalize(control.getAttribute('aria-label') || control.textContent))) {
          prefs.resetDraft(key);
          pendingSend = null; pendingChoice = null; pendingNativeCapture = false; conversationPreference = null; verified = ''; blocked = '';
          renderPanel();
        }
      }
      schedule(1450);
    }

    async function captureNativePreference(check) {
      const read = await readCurrentPreferenceFromNative(check, true);
      if (read.unavailable) {
        pendingNativeCapture = false;
        blocked = 'native-unavailable|' + read.model.key;
        status('不可用：' + read.reason + '；保留原偏好');
        return;
      }
      const preference = normalizePreference(read.preference);
      if (!preference) throw new Error('手动选择的模型偏好无法保存');
      prefs.save(key, preference);
      rememberConversationPreference(preference);
      pendingNativeCapture = false;
      pendingChoice = null;
      confirmedPreference = preference.effortState === 'unknown' ? null : preference;
      updateEffortUi(preference.modelKey, read.effortState);
      verified = targetSignature(preference, picker()?.textContent || '');
      blocked = preference.effortState === 'unknown' ? 'unknown-effort|' + preference.modelKey : '';
      status(preference.effortState === 'unknown' ? '模型已记录，强度控件无法识别' : '已确认');
    }

    async function reconcile() {
      route();
      if (working) return;
      if (isBusy()) {
        status(pendingChoice || pendingNativeCapture ? '等待空闲后应用所选组合' : '等待页面空闲');
        schedule(1200);
        return;
      }
      const button = picker();
      if (!button) { status('等待 ChatGPT 原生模型控件'); return; }
      const buttonText = normalize(button.textContent);
      const requestedChoice = pendingChoice;
      const desired = desiredConversationPreference();
      const signature = targetSignature(desired, buttonText);
      if (blocked.startsWith('native-unavailable|') && !pendingChoice && !pendingNativeCapture) return;
      if (!pendingNativeCapture && !pendingChoice && (verified === signature || blocked === signature)) return;
      working = true; ownedMenu = false; userOwnsMenu = false;
      status(pendingChoice ? '正在应用所选组合' : '正在读取并核对原生选项');
      const epoch = serial, routeKey = key, oldFocus = doc.activeElement;
      const check = () => cancellationCheck(epoch, routeKey);
      let applied = null;
      try {
        if (pendingNativeCapture) {
          await captureNativePreference(check);
          return;
        }
        let modelState = await openModelOptions(check);
        const targetModel = findModel(modelState.items, desired);
        if (!targetModel) throw new Error('原生菜单没有唯一匹配的目标模型');
        if (targetModel.disabled) {
          blocked = signature;
          status('不可用：' + (targetModel.reason || '原生菜单限制了此模型'));
          return;
        }
        let selected = modelState.selected;
        if (!selected || selected.key !== targetModel.key) {
          const element = modelState.elements.find(item => modelInfo(item).key === targetModel.key);
          if (!element || modelUnavailableReason(element)) {
            blocked = signature;
            status('不可用：原生模型菜单禁止选择此项');
            return;
          }
          check();
          element.click();
          await delay(120);
          check();
          await closeOwnedMenus();
          modelState = await openModelOptions(check);
          selected = modelState.selected;
          if (!selected || selected.key !== targetModel.key) throw new Error('模型没有通过原生勾选状态确认');
        }
        if (selected.disabled) {
          blocked = signature;
          status('不可用：' + (selected.reason || '所选模型受原生限制'));
          return;
        }
        await closeOwnedMenus();
        await openParentMenu(check);
        const effortState = await discoverEfforts(check, selected.key);
        updateEffortUi(selected.key, effortState);
        let confirmed;
        if (effortState.kind === 'value') {
          let chosen = null;
          if (desired.effortState === 'value') {
            chosen = findEffortOption(effortState.options, { ...desired, modelKey: selected.key });
          }
          if (desired.effortState === 'unknown' && requestedChoice && requestedChoice.effortState === 'unknown') chosen = effortState.current;
          if (!chosen) throw new Error('目标档位不在该模型当前提供的原生选项中');
          let verifiedEffort = effortState.current;
          let observedLabel = chosen.label;
          if (!effortState.current || effortState.current.key !== chosen.key) {
            const beforeEffort = currentEffort();
            verifiedEffort = await moveSliderTo(chosen.value, check);
            observedLabel = await waitForEffortCaption(
              verifiedEffort,
              beforeEffort.statusText,
              beforeEffort.label || '',
              chosen.label,
              check
            );
          }
          verifiedEffort = currentEffort();
          if (verifiedEffort.state !== 'range' || verifiedEffort.value !== chosen.value) throw new Error('强度档位没有通过原生滑杆值确认');
          const actualLabel = resolveEffortLabel(chosen.label, observedLabel);
          const resolvedOptions = effortState.options.map(option =>
            option.value === chosen.value && actualLabel ? { ...option, label: actualLabel } : option
          );
          updateEffortUi(selected.key, { ...effortState, options: resolvedOptions });
          confirmed = {
            modelKey: selected.key,
            modelLabel: selected.label,
            effortKey: chosen.key,
            effortLabel: actualLabel || chosen.label,
            effortState: 'value'
          };
        } else if (effortState.kind === 'none') {
          if (desired.effortState === 'value' && !(requestedChoice && requestedChoice.effortState === 'unknown')) throw new Error('已保存的档位与该模型当前控件不匹配');
          confirmed = { modelKey: selected.key, modelLabel: selected.label, effortKey: null, effortLabel: '', effortState: 'none' };
        } else {
          if (desired.effortState === 'value') throw new Error(effortState.reason || '强度控件无法识别');
          confirmed = { modelKey: selected.key, modelLabel: selected.label, effortKey: null, effortLabel: '', effortState: 'unknown' };
        }
        check();
        prefs.save(key, confirmed);
        if (requestedChoice) rememberConversationPreference(confirmed);
        pendingChoice = null; pendingNativeCapture = false;
        confirmedPreference = confirmed.effortState === 'unknown' ? null : confirmed;
        applied = confirmed;
        verified = targetSignature(confirmed, picker()?.textContent || '');
        blocked = confirmed.effortState === 'unknown' ? 'unknown-effort|' + confirmed.modelKey : '';
        status(confirmed.effortState === 'unknown' ? '模型已确认，强度控件无法识别' : '已确认');
      } catch (error) {
        try { check(); } catch (_) {
          blocked = ''; pendingChoice = null;
          status('用户开始操作或切换了聊天，脚本已让出控件');
          return;
        }
        blocked = targetSignature(desired, normalize(picker()?.textContent || ''));
        confirmedPreference = null;
        status('暂停：' + error.message);
        console.warn('[ChatGPT model preference]', error.message);
      } finally {
        await closeOwnedMenus();
        if (serial === epoch && oldFocus?.isConnected && typeof oldFocus.focus === 'function') {
          try { oldFocus.focus({ preventScroll: true }); } catch (_) { /* ignored */ }
        }
        working = false;
        if (!applied && (pendingNativeCapture || pendingChoice)) schedule(1450);
        renderPanel();
      }
    }

    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup', 'click', 'input', 'change']) {
      doc.addEventListener(type, interaction, true);
    }
    doc.addEventListener('compositionstart', () => { composing = true; }, true);
    doc.addEventListener('compositionend', () => { composing = false; lastInput = Date.now(); schedule(1450); }, true);
    new win.MutationObserver(records => {
      if (panelUi && !panelUi.host.isConnected) mountPanel();
      let settingsChanged = false;
      for (const record of records) {
        if (record.type === 'attributes' && ['aria-valuenow', 'aria-checked', 'aria-expanded', 'aria-disabled', 'disabled'].includes(record.attributeName)) {
          const target = record.target;
          if (target.closest?.('[role="menu"],button[aria-label*="模型"],button[aria-label*="model"]')) settingsChanged = true;
        }
        if ((record.type === 'childList' || record.type === 'characterData') &&
            (record.target.parentElement?.closest?.('[role="menu"]') || record.target.closest?.(PICKER))) settingsChanged = true;
      }
      if (settingsChanged) schedule();
    }).observe(doc.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['aria-valuenow', 'aria-checked', 'aria-expanded', 'aria-disabled', 'disabled']
    });
    win.addEventListener('storage', event => {
      if (event.key === PREFIX + key) {
        conversationPreference = null;
        verified = ''; blocked = ''; renderPanel(); schedule();
      }
    });
    win.addEventListener('popstate', () => { pendingSend = null; schedule(); });
    win.addEventListener('blur', () => { pointerDown = false; });
    doc.addEventListener('visibilitychange', () => schedule());
    win.addEventListener('load', () => schedule(250), { once: true });
    win.setInterval(() => {
      const previousKey = key;
      route();
      const currentButton = normalize(picker()?.textContent || '');
      if (previousKey !== key || (lastObservedButton && currentButton !== lastObservedButton)) {
        verified = ''; blocked = '';
        schedule(250);
      }
      lastObservedButton = currentButton;
    }, 1500);
    prefs.ensure(key);
    mountPanel();
    schedule(250);
  }

  return {
    VERSION,
    PANEL_KEY,
    PREFIX,
    LEGACY_PREFIX,
    DEFAULT_PREFERENCE,
    Preferences,
    context,
    normalize,
    effortLabelFromStatus,
    effortItemIndexFromStatus,
    effortKey,
    effortValueKey,
    findEffortOption,
    buildEffortOptions,
    isLimitHint,
    createModelOption,
    isManualNativeAction,
    findModel,
    normalizePreference,
    normalizePanelSettings,
    readPanelSettings,
    clampPanelPosition,
    panelSummary,
    resolveConversationPreference,
    resolveEffortLabel,
    start
  };
});
