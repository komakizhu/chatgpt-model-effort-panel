// ==UserScript==
// @name         ChatGPT 模型与档位
// @namespace    local.chatgpt-preference
// @version      0.5.4
// @description  读取 ChatGPT 页面真实模型与档位，并按聊天保存已确认偏好。
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

  const VERSION = '0.5.4';
  const PANEL_KEY = 'chatgpt-model-panel-v1';
  const PREFIX = 'chatgpt-model-preference-v2:';
  const LEGACY_PREFIX = 'chatgpt-56-preference-v1:';
  const PICKER = 'button[aria-label="选择 ChatGPT 模型"],button[aria-label="Select ChatGPT model"],[role="button"][aria-label="选择 ChatGPT 模型"],[role="button"][aria-label="Select ChatGPT model"]';
  const CHOOSER_LABELS = new Set(['选择模型', 'Choose model', 'Select model']);
  const DEFAULT_MODEL_LABEL = 'GPT-5.6 Sol';
  const DEFAULT_MODEL_KEY = 'label:gpt-5.6 sol';
  const DEFAULT_EFFORT_KEY = 'effort-value:' + encodeURIComponent(DEFAULT_MODEL_KEY) + ':1';
  const LEGACY_EFFORTS = ['Low', 'Medium', 'High', 'Extra High', 'Max'];
  const EFFORT_LABEL_ALIASES = Object.freeze({
    low: 'Low',
    '即时': 'Instant',
    instant: 'Instant',
    '低': 'Low',
    med: 'Medium',
    mid: 'Medium',
    medium: 'Medium',
    '中': 'Medium',
    '中等': 'Medium',
    high: 'High',
    '高': 'High',
    'extra high': 'Extra High',
    'x high': 'Extra High',
    xhigh: 'Extra High',
    'very high': 'Extra High',
    '极高': 'Extra High',
    max: 'Max',
    '最高': 'Max',
    '最大': 'Max'
  });
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

  function resolveCurrentModelPreference(catalog, saved, buttonText) {
    const rawText = normalize(buttonText);
    const text = normalizedKey(rawText);
    // The model button can include its effort after a separator. Keep the full
    // readable model name before that separator so variants such as GPT-6 Thinking
    // don't collapse to GPT-6 when the model catalog is unavailable or incomplete.
    const modelText = rawText.split(/\s*[·•]\s*/, 1)[0];
    const observedLabel = modelText.match(/\bGPT-\s*\d+(?:\.\d+)*(?:\s+[A-Za-z][A-Za-z0-9._-]*)*/i)?.[0] || '';
    if (observedLabel) {
      const observedKey = normalizedKey(panelModelLabel(observedLabel));
      const exactMatches = (catalog || []).filter(item =>
        normalizedKey(panelModelLabel(item.label)) === observedKey
      );
      if (exactMatches.length === 1) return exactMatches[0];
      if (exactMatches.length > 1) return null;

      // A visible model name describes the page's current model, not the saved target.
      // Keep the saved key only when the button explicitly confirms that exact model.
      const sameAsSaved = saved?.modelLabel &&
        normalizedKey(panelModelLabel(saved.modelLabel)) === normalizedKey(panelModelLabel(observedLabel));
      return sameAsSaved
        ? createModelOption({ key: saved.modelKey, label: saved.modelLabel })
        : createModelOption({ label: observedLabel });
    }

    // Some native controls show only a shortened family label such as "5.6 中".
    // Use the catalog only when the visible text doesn't expose a complete GPT name.
    const candidates = (catalog || []).map(item => {
      const fragment = normalizedKey(panelModelLabel(item.label).replace(/^gpt-/i, ''));
      return fragment && text.includes(fragment) ? { item, length: fragment.length } : null;
    }).filter(Boolean).sort((a, b) => b.length - a.length);
    if (candidates[0]?.item) return candidates[0].item;
    return null;
  }

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

  function preferredExpandedPanelPosition(viewport, panel, editorRect, voiceRect, gap = 12) {
    let right = gap;
    let bottom = gap;
    if (editorRect && editorRect.top > 0 && editorRect.top < viewport.height) {
      bottom = Math.max(bottom, viewport.height - editorRect.top + gap);
    }
    if (voiceRect) {
      if (voiceRect.left - gap >= panel.width) right = viewport.width - voiceRect.left + gap;
      if (voiceRect.top > 0 && voiceRect.top < viewport.height) {
        bottom = Math.max(bottom, viewport.height - voiceRect.top + gap);
      }
    }
    return clampPanelPosition({ right, bottom }, viewport, panel);
  }

  function preferredPanelPosition(viewport, panel, editorRect, voiceRect, gap = 12) {
    let right = gap;
    let bottom = gap;
    // 折叠态默认停在输入栏右侧的留白处；只有视口太窄放不下时，才贴到录音按钮右边。
    // 这样不会把面板抬到输入框上方，也不会遮住录音按钮。
    if (voiceRect && Number.isFinite(voiceRect.right) &&
        viewport.width - gap - panel.width < voiceRect.right + gap) {
      right = Math.max(0, viewport.width - voiceRect.right - gap - panel.width);
    }
    return clampPanelPosition({ right, bottom }, viewport, panel);
  }

  function panelSummary(wanted, current) {
    const describe = preference => {
      if (!preference) return '未设置';
      const modelLabel = panelModelLabel(preference.modelLabel);
      if (preference.effortState === 'none') return modelLabel + ' · 无强度';
      if (preference.effortState === 'unknown') {
        return modelLabel + ' · ' + (canonicalEffortLabel(preference.observedEffortLabel) || '档位未识别');
      }
      return modelLabel + ' · ' + preference.effortLabel;
    };
    // 折叠态只显示网页当前已核对的组合，不把目标偏好或等待状态冒充成页面事实。
    return { text: current ? describe(current) : '', state: '' };
  }

  const PANEL_MODEL_SLOTS = Object.freeze([
    { key: 'gpt-5.6', label: 'GPT-5.6' },
    { key: 'gpt-6', label: 'GPT-6' }
  ]);
  const PANEL_EFFORT_SLOTS = Object.freeze([
    { key: 'low', label: 'Low', canonical: 'Low' },
    { key: 'medium', label: 'Mid', canonical: 'Medium' },
    { key: 'high', label: 'High', canonical: 'High' },
    { key: 'extra-high', label: 'X High', canonical: 'Extra High' },
    { key: 'pro', label: 'Pro', canonical: 'Pro' }
  ]);

  function panelModelSlot(value) {
    const key = normalizedKey(panelModelLabel(value));
    return PANEL_MODEL_SLOTS.find(slot => normalizedKey(slot.label) === key) || null;
  }

  function panelEffortSlot(value) {
    const label = canonicalEffortLabel(value);
    return PANEL_EFFORT_SLOTS.find(slot => normalizedKey(slot.canonical) === normalizedKey(label)) || null;
  }

  function shouldPreventPanelMouseFocus(event, control) {
    return Boolean(control && event?.type === 'pointerdown' && event.button === 0 &&
      event.cancelable && typeof event.preventDefault === 'function');
  }

  function modelCatalogSignature(items) {
    return (items || []).map(item => [
      item.key, item.label, item.category, item.checked, item.disabled, item.reason, item.availability?.state
    ].join(':')).join('|');
  }

  function readVisibleModelCatalog(menus, modelInfo, isVisible) {
    if (!Array.isArray(menus) || !menus.length) return [];
    const elements = menus.flatMap(menu => [...menu.querySelectorAll('[role="menuitemradio"]')]).filter(isVisible);
    const items = elements.map(modelInfo).filter(item => item.label && item.key);
    return items.some(item => panelModelSlot(item.label)) ? items : [];
  }

  function createModelEffortControls(doc, onModelSelect, onEffortSelect) {
    const root = doc.createElement('div');
    root.className = 'model-controls';
    const modelGroup = doc.createElement('div');
    modelGroup.className = 'model-buttons';
    modelGroup.setAttribute('role', 'group');
    modelGroup.setAttribute('aria-label', '选择模型');
    const modelNotice = doc.createElement('p');
    modelNotice.className = 'model-note';
    modelNotice.id = 'chatgpt-model-availability';
    modelNotice.setAttribute('role', 'status');
    modelNotice.setAttribute('aria-live', 'polite');
    modelNotice.hidden = true;
    const effortGroup = doc.createElement('div');
    effortGroup.className = 'effort-buttons';
    effortGroup.setAttribute('role', 'group');
    effortGroup.setAttribute('aria-label', '选择思考强度');
    const effortNotice = doc.createElement('p');
    effortNotice.className = 'effort-note';
    effortNotice.id = 'chatgpt-effort-availability';
    effortNotice.setAttribute('role', 'status');
    effortNotice.setAttribute('aria-live', 'polite');
    effortNotice.hidden = true;
    const modelButtons = new Map();
    const effortButtons = new Map();
    let modelBySlot = new Map();
    let effortBySlot = new Map();

    for (const slot of PANEL_MODEL_SLOTS) {
      const button = doc.createElement('button');
      button.className = 'model-choice';
      button.type = 'button';
      button.textContent = slot.label;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-describedby', modelNotice.id);
      button.dataset.chatgptPanelControl = '';
      button.dataset.chatgptPreserveFocus = '';
      button.addEventListener('click', event => {
        const model = modelBySlot.get(slot.key);
        if (event.isTrusted && model && !button.disabled) onModelSelect(model);
      });
      modelGroup.append(button);
      modelButtons.set(slot.key, button);
    }

    for (const slot of PANEL_EFFORT_SLOTS) {
      const button = doc.createElement('button');
      button.className = 'effort-choice';
      button.type = 'button';
      button.textContent = slot.label;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-describedby', effortNotice.id);
      button.dataset.chatgptPanelControl = '';
      button.dataset.chatgptPreserveFocus = '';
      button.addEventListener('click', event => {
        const selection = effortBySlot.get(slot.key);
        if (event.isTrusted && selection && !button.disabled) {
          onEffortSelect(selection.model, selection.option.key);
        }
      });
      effortGroup.append(button);
      effortButtons.set(slot.key, button);
    }

    root.append(modelGroup, modelNotice, effortGroup, effortNotice);

    function update({
      catalog = [], current = null, effortModelKey = '', effortOptions = [], observedEffortLabel = '',
      writerAvailable = false, writerReason = '未发现可确认的同源档位接口', pendingChoice = null
    } = {}) {
      const byModelSlot = new Map(PANEL_MODEL_SLOTS.map(slot => [slot.key, []]));
      for (const model of catalog) {
        const slot = panelModelSlot(model.label);
        if (slot) byModelSlot.get(slot.key).push(model);
      }
      const nextModelBySlot = new Map();
      const modelMessages = [];
      const pendingModelChange = Boolean(pendingChoice && pendingChoice.modelKey !== current?.modelKey);
      for (const slot of PANEL_MODEL_SLOTS) {
        const matches = byModelSlot.get(slot.key);
        const currentMatches = current?.modelKey && panelModelSlot(current.modelLabel)?.key === slot.key;
        const ambiguous = matches.length > 1;
        let model = matches.length === 1 ? matches[0] : null;
        if (!model && currentMatches) {
          model = {
            key: current.modelKey,
            label: current.modelLabel,
            disabled: true,
            availability: { state: 'unknown', reason: ambiguous ? '模型目录存在重复项' : '模型目录尚未读取' },
            reason: ambiguous ? '模型目录存在重复项' : '模型目录尚未读取'
          };
        }
        const reason = ambiguous
          ? '模型目录存在重复项，暂不能安全选择'
          : !model
            ? '状态未确认，暂不能选择'
            : modelAvailabilityLabel(model) || (model.availability?.state === 'unknown' ? '状态未确认，暂不能选择' : '');
        const selected = Boolean(currentMatches && (!model || model.key === current.modelKey));
        const button = modelButtons.get(slot.key);
        button.disabled = !model || ambiguous || model.disabled || model.availability?.state === 'unknown';
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-label', slot.label + (selected ? '，当前模型' : '') + (reason ? '，' + reason : ''));
        button.title = reason || slot.label;
        button.dataset.selected = String(selected);
        if (model && !button.disabled) nextModelBySlot.set(slot.key, model);
        if (reason) modelMessages.push(slot.label + '：' + reason);
      }
      modelBySlot = nextModelBySlot;
      modelNotice.textContent = modelMessages.join('；');
      modelNotice.hidden = modelMessages.length === 0;

      const currentModelSlot = current && panelModelSlot(current.modelLabel);
      const currentModelKnown = Boolean(current && currentModelSlot &&
        catalog.some(model => model.key === current.modelKey && !model.disabled && model.availability?.state !== 'unknown'));
      const currentLabel = canonicalEffortLabel(current?.effortLabel || observedEffortLabel);
      const currentEffort = panelEffortSlot(currentLabel);
      const optionBySlot = new Map();
      for (const slot of PANEL_EFFORT_SLOTS) {
        const matches = effortOptions.filter(option => panelEffortSlot(option.label)?.key === slot.key);
        if (matches.length === 1) optionBySlot.set(slot.key, matches[0]);
      }
      const pendingEffort = pendingChoice?.effortState === 'value';
      const modelPending = pendingModelChange;
      const effortSelectionEnabled = currentModelKnown && current?.effortState !== 'none' &&
        current?.effortState !== 'unknown' && effortModelKey === current.modelKey && !modelPending && !pendingEffort;
      const nextEffortBySlot = new Map();
      let effortMessage = '';
      if (modelPending) {
        effortMessage = '等待页面确认模型切换，强度选项暂时停用';
      } else if (!current) {
        effortMessage = '等待页面确认当前模型和强度';
      } else if (current.effortState === 'none') {
        effortMessage = '当前模型没有强度设置';
      } else if (current.effortState === 'unknown' && !currentLabel) {
        effortMessage = '档位未识别，强度选项暂时停用';
      } else if (!writerAvailable) {
        effortMessage = '档位修改受阻：' + writerReason;
      } else if (!effortOptions.length) {
        effortMessage = '页面尚未确认可用的强度选项';
      }

      for (const slot of PANEL_EFFORT_SLOTS) {
        const option = optionBySlot.get(slot.key) || null;
        const isCurrent = currentEffort?.key === slot.key && current?.modelKey === effortModelKey;
        const button = effortButtons.get(slot.key);
        const model = currentModelSlot
          ? catalog.find(item => item.key === current.modelKey && panelModelSlot(item.label)?.key === currentModelSlot.key)
          : null;
        const available = Boolean(effortSelectionEnabled && model && !model.disabled &&
          model.availability?.state !== 'unknown' && option && writerAvailable);
        button.disabled = !available;
        button.setAttribute('aria-pressed', String(Boolean(isCurrent)));
        let reason = '';
        if (available) {
          reason = isCurrent ? '当前档位' : '';
          nextEffortBySlot.set(slot.key, { model, option });
        } else if (!option) {
          reason = isCurrent && current?.effortState === 'unknown'
            ? '当前名称已识别，但档位值未确认'
            : '选项未确认：页面未提供此档位的名称和值';
        } else if (!writerAvailable) {
          reason = '档位修改受阻：' + writerReason;
        } else if (modelPending) {
          reason = '等待页面确认模型切换';
        } else if (!currentModelKnown) {
          reason = '当前模型可用状态未确认';
        }
        button.setAttribute('aria-label', slot.label + (isCurrent ? '，当前档位' : '') + (reason ? '，' + reason : ''));
        button.title = reason || slot.label;
        button.dataset.selected = String(Boolean(isCurrent));
      }
      effortBySlot = nextEffortBySlot;
      if (!effortMessage && effortOptions.length < PANEL_EFFORT_SLOTS.length) {
        effortMessage = '未读取到的强度选项保持停用';
      }
      effortNotice.textContent = effortMessage;
      effortNotice.hidden = !effortMessage;
    }

    return { element: root, modelButtons, effortButtons, modelNotice, effortNotice, update };
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

  function canonicalEffortLabel(value) {
    const text = normalize(value);
    if (!text || /^原生第\s*\d+\s*档$/i.test(text)) return '';
    const key = text.toLocaleLowerCase().replace(/\s+/g, ' ');
    return EFFORT_LABEL_ALIASES[key] || text;
  }

  function effortLabelFromText(value) {
    const text = normalize(value);
    if (!text) return '';
    const labels = '(?:extra\\s*high|very\\s*high|x\\s*high|medium|med|mid|high|low|instant|xhigh|max|即时|低|中等|中|高|极高|最高|最大)';
    const match = text.match(new RegExp('(?:^|[\\s·•,，:：|/])(' + labels + ')(?=$|[\\s·•,，:：|/])', 'i'));
    if (match) return canonicalEffortLabel(match[1]);
    return canonicalEffortLabel(effortLabelFromStatus(text));
  }

  function observeEffortPreference(saved, pageText, current) {
    const base = normalizePreference(saved);
    if (!base) return null;
    const value = Number.isInteger(current?.value) ? current.value : null;
    const min = Number.isInteger(current?.min) ? current.min : null;
    const itemIndex = Number.isInteger(current?.itemIndex) ? current.itemIndex : effortItemIndexFromStatus(pageText);
    const expectedItem = value !== null && min !== null ? value - min + 1 : null;
    const itemMatches = itemIndex === null || expectedItem === null || itemIndex === expectedItem;
    const label = itemMatches && (
      effortLabelFromText(pageText) || canonicalEffortLabel(current?.accessibleLabel || current?.label)
    );
    if (!label) return {
      ...base,
      effortKey: null,
      effortLabel: '',
      effortState: 'unknown',
      observedEffortLabel: ''
    };
    if (value === null || min === null) {
      // 折叠态可能只有模型按钮的可读文案，没有展开的滑杆数值。
      // 只有文案与已保存的真实标签一致时，才复用旧的数值键；否则保持未识别。
      const legacyOrdinal = /^原生第\s*\d+\s*档$/i.test(normalize(base.effortLabel));
      if (base.effortState !== 'value' || (!legacyOrdinal && effortKey(base.effortLabel) !== effortKey(label))) {
        return {
          ...base,
          effortKey: null,
          effortLabel: '',
          effortState: 'unknown',
          observedEffortLabel: label
        };
      }
      return { ...base, effortLabel: label, effortState: 'value', observedEffortLabel: label };
    }
    return {
      ...base,
      effortKey: effortValueKey(base.modelKey, value),
      effortLabel: label,
      effortState: 'value',
      observedEffortLabel: label
    };
  }

  function createEffortBackendAdapter(implementation) {
    const reason = '未发现可确认的同源档位接口';
    const canRead = !!implementation && typeof implementation.read === 'function';
    const canWrite = !!implementation && typeof implementation.write === 'function';
    const invoke = async (method, payload, options) => {
      if (!implementation || typeof implementation[method] !== 'function') {
        return { ok: false, reason };
      }
      try {
        const result = await implementation[method](payload, options);
        if (!result || typeof result.ok !== 'boolean') return { ok: false, reason: '后端响应无法确认' };
        return result;
      } catch (error) {
        return { ok: false, reason: normalize(error?.message) || '后端请求失败' };
      }
    };
    return Object.freeze({
      available: canWrite,
      canRead,
      canWrite,
      reason: canWrite ? '' : reason,
      read: (payload, options) => invoke('read', payload, options),
      write: (payload, options) => invoke('write', payload, options)
    });
  }

  function preferenceMatches(actual, target) {
    return actual && target && actual.modelKey === target.modelKey &&
      actual.effortState === target.effortState &&
      (target.effortState !== 'value' || actual.effortKey === target.effortKey);
  }

  async function confirmEffortWrite({
    adapter, payload, target, readCurrent, check, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = () => Date.now(), timeoutMs = 5000, signal
  }) {
    if (!adapter?.available) return { ok: false, reason: adapter?.reason || '未发现可确认的同源档位接口' };
    check();
    if (signal?.aborted) return { ok: false, reason: '档位修改已取消' };
    const written = await adapter.write(payload, { signal });
    if (signal?.aborted) return { ok: false, reason: '档位修改已取消' };
    if (!written?.ok) return { ok: false, reason: written?.reason || '后端请求失败' };
    const deadline = now() + timeoutMs;
    let read = null;
    while (true) {
      if (signal?.aborted) return { ok: false, reason: '档位修改已取消', read };
      check();
      read = await readCurrent();
      if (signal?.aborted) return { ok: false, reason: '档位修改已取消', read };
      check();
      const preference = normalizePreference(read?.preference);
      if (preferenceMatches(preference, target)) return { ok: true, read, preference };
      const remaining = deadline - now();
      if (remaining <= 0) return { ok: false, reason: '页面未在 5 秒内确认切换结果', read };
      await wait(Math.min(150, remaining));
    }
  }

  function effortKey(label) {
    const text = normalizedKey(canonicalEffortLabel(label));
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
      const caption = captions && captions[value];
      const itemIndex = effortItemIndexFromStatus(caption);
      if (itemIndex !== null && itemIndex !== value - min + 1) {
        return { kind: 'unknown', options: [], reason: '档位文案与当前值不一致' };
      }
      const label = effortLabelFromText(caption);
      if (!label) return { kind: 'unknown', options: [], reason: '档位名称无法从页面真实状态确认' };
      options.push({ value, key: effortValueKey(modelKey, value), label });
    }
    return { kind: 'value', options, reason: '' };
  }

  function isLimitHint(value) {
    return /已达到使用限额|已达使用限额|已锁定.{0,20}访问权限|usage\s+limit\s+reached|limit\s+reached|locked.{0,40}access\s+options/i.test(normalize(value));
  }

  function classifyModelAvailability(reason, disabled = false) {
    const text = normalize(reason);
    const limited = /已达到使用限额|已达使用限额|usage\s+limit\s+reached|limit\s+reached/i.test(text);
    const permission = /已锁定|访问权限|权限受限|需要权限|access\s+options|permission\s+(?:required|restricted)|locked/i.test(text);
    if (limited && permission) return { state: 'limited-and-permission', reason: text };
    if (limited) {
      return { state: 'limited', reason: text || '已达到使用限额' };
    }
    if (permission) {
      return { state: 'permission', reason: text || '需要访问权限' };
    }
    if (disabled || text) return { state: 'restricted', reason: text || '原生控件标记为不可用' };
    return { state: 'available', reason: '' };
  }

  function isAvailabilityHint(value) {
    return /限额|已锁定|访问权限|权限受限|需要权限|不可用|不可访问|已禁用|不支持|usage\s+limit|limit\s+reached|locked|access\s+options|permission|unavailable|not\s+available|disabled|not\s+supported/i.test(normalize(value));
  }

  function modelAvailabilityLabel(model) {
    const availability = model?.availability || classifyModelAvailability(model?.reason, model?.disabled);
    if (availability.state === 'limited' || availability.state === 'permission' ||
        availability.state === 'limited-and-permission' || availability.state === 'restricted') {
      return availability.reason || '原生控件标记为不可用';
    }
    if (availability.state === 'unknown') return availability.reason || '状态未确认';
    return '';
  }

  function effortRowPresentation({ selected, model, observedLabel, options, writerAvailable }) {
    const label = canonicalEffortLabel(observedLabel);
    if (model?.disabled) {
      return { label: modelAvailabilityLabel(model) || '不可用', disabled: true, title: modelAvailabilityLabel(model) || '模型不可用' };
    }
    if (selected && label && (!options || options.length === 0)) {
      const reason = writerAvailable ? '已识别当前档位，其他选项尚未确认' : '档位修改受阻：未发现可确认的同源档位接口';
      return { label, disabled: true, title: reason };
    }
    if (!selected || !options || options.length === 0) {
      return { label: selected ? '档位未识别' : '选择模型后读取强度', disabled: true, title: '' };
    }
    if (!writerAvailable) {
      return {
        label: '',
        disabled: true,
        title: '档位修改受阻：未发现可确认的同源档位接口'
      };
    }
    return { label: '', disabled: false, title: '' };
  }

  function createModelOption(input) {
    const data = input || {};
    const label = normalize(data.label);
    const stableId = normalize(data.stableId || '');
    const key = normalize(data.key) || (stableId ? 'id:' + normalizedKey(stableId) : label ? 'label:' + normalizedKey(label) : '');
    const category = normalize(data.category || '');
    const reason = normalize(data.reason || '');
    const availability = data.availability || classifyModelAvailability(reason, Boolean(data.disabled));
    const blockedAvailability = ['limited', 'permission', 'limited-and-permission', 'restricted'].includes(availability.state);
    return {
      key,
      label,
      category,
      checked: Boolean(data.checked),
        disabled: Boolean(data.disabled || blockedAvailability),
        reason: reason || availability.reason,
        availability
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
    const effortBackend = createEffortBackendAdapter();
    const panelStorage = readPanelSettings(win.localStorage);
    let panelSettings = panelStorage.settings, panelStorageAvailable = panelStorage.available;
    let drag = null, positionFrame = 0;
    let positionAnchorObserver = null, positionAnchors = new Set();
    let key = context(win.location.pathname), timer = 0, captureTimer = 0;
    let serial = 0, lastInput = 0, voiceInputUntil = 0, pointerDown = false, composing = false;
    let working = false, ownedMenu = false, userOwnsMenu = false, activeWriteController = null;
    let pendingChoice = null, pendingNativeCapture = false;
    let conversationPreference = null;
    let verified = '', blocked = '', lastObservedButton = '', statusText = '正在读取原生模型选项';
    let catalog = [], catalogReadSignature = '', effortOptions = [], effortModelKey = '', effortObservedLabel = '', confirmedPreference = null;
    let panelUi = null, pendingSend = null;

    const visible = element => !!element && element.isConnected && element.getClientRects().length > 0 &&
      win.getComputedStyle(element).visibility !== 'hidden' && win.getComputedStyle(element).display !== 'none';
    const picker = () => {
      const exact = [...doc.querySelectorAll(PICKER)].find(visible);
      if (exact) return exact;
      return [...doc.querySelectorAll('button,[role="button"]')].find(element => {
        if (!visible(element) || element.closest?.('[data-chatgpt-model-panel],[role="menu"]')) return false;
        const accessible = normalize(element.getAttribute('aria-label'));
        const text = normalize(element.textContent);
        return /(?:模型|model)/i.test(accessible) || /(?:GPT-\d|\b5\.6\b|\b(?:Low|Medium|High|Max)\b|低|中|高|极高|最高)/i.test(text);
      });
    };
    const readNativeModelText = element => {
      const values = [];
      const add = value => {
        const text = normalize(value);
        if (!text || text.length > 240 || values.includes(text)) return;
        if (effortLabelFromText(text) || /GPT-\d|\b5\.6\b/i.test(text)) values.push(text);
      };
      if (!element) return '';
      add(element.getAttribute('aria-label'));
      add(element.getAttribute('aria-valuetext'));
      add(element.getAttribute('title'));
      add(element.innerText || element.textContent);
      for (const attribute of ['aria-labelledby', 'aria-describedby']) {
        for (const id of normalize(element.getAttribute(attribute)).split(/\s+/).filter(Boolean)) {
          add(doc.getElementById(id)?.innerText || doc.getElementById(id)?.textContent);
        }
      }
      return values.join(' · ');
    };
    const menus = () => [...doc.querySelectorAll('[role="menu"]')].filter(visible);
    const slider = () => menus().map(menu => menu.querySelector('[role="slider"]')).find(visible) || null;
    const stopButton = () => [...doc.querySelectorAll('button[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="停止流式传输"]')].find(visible);
    const voiceButton = () => {
      const buttons = [...doc.querySelectorAll('button')].filter(visible);
      const matches = buttons.filter(element => /(?:听写|dictate|开始语音|start voice|录音|record|停止录音|stop recording|停止听写|stop dictation)/i.test(
        normalize(element.getAttribute('aria-label') || element.textContent)
      ));
      return matches.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0] || null;
    };
    const composer = () => [...doc.querySelectorAll('textarea,[contenteditable="true"]')].find(visible);
    const voiceBusy = () => {
      if (Date.now() < voiceInputUntil) return true;
      const button = voiceButton();
      if (!button) return false;
      const state = normalize(button.getAttribute('aria-pressed') || button.getAttribute('data-state'));
      const label = normalize(button.getAttribute('aria-label') || button.textContent);
      return state === 'true' || /^(?:on|open|active)$/i.test(state) || /(?:停止|结束|stop|end)/i.test(label);
    };
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
      const described = normalize(element.getAttribute('aria-describedby')).split(/\s+/).filter(Boolean)
        .map(id => normalize(doc.getElementById(id)?.textContent))
        .filter(isAvailabilityHint);
      const accessibleDescription = normalize(element.getAttribute('aria-description'));
      const directReason = [
        directDisabled || isAvailabilityHint(accessibleDescription) ? accessibleDescription : '',
        ...described,
        directDisabled ? normalize(element.getAttribute('title')) : ''
      ].filter(Boolean).join(' · ');
      const parent = element.parentElement;
      if (!parent) return directReason || (directDisabled ? '原生控件标记为不可用' : '');
      const siblings = [...parent.children];
      const index = siblings.indexOf(element);
      const hints = [];
      for (let i = index - 1; i >= 0; i--) {
        const sibling = siblings[i];
        if (sibling.matches('[role="menuitemradio"]')) break;
        if (sibling.matches('.sr-only,[role="status"],[aria-live]')) {
          const text = normalize(sibling.textContent);
          if (isAvailabilityHint(text)) hints.unshift(text);
        }
      }
      const reason = normalize([directReason, ...hints].filter(Boolean).join(' · '));
      const availability = classifyModelAvailability(reason, directDisabled);
      return availability.state === 'available' ? '' : availability.reason;
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
        disabled: element.matches(':disabled,[aria-disabled="true"],[data-disabled="true"]') ||
          element.getAttribute('data-state') === 'disabled' || !!reason,
        reason
      });
    }

    function modelElements() {
      return menus().flatMap(menu => [...menu.querySelectorAll('[role="menuitemradio"]')].filter(visible));
    }

    function observeVisibleModelCatalog() {
      if (working || ownedMenu || !menus().length) return false;
      const items = readVisibleModelCatalog(menus(), modelInfo, visible);
      if (!items.length) return false;
      const signature = modelCatalogSignature(items);
      if (signature === catalogReadSignature) return false;
      catalogReadSignature = signature;
      catalog = items;
      renderPanel();
      return true;
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
      return doc.readyState !== 'complete' || doc.hidden || pointerDown || composing || voiceBusy() ||
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
      catalogReadSignature = modelCatalogSignature(items);
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

    function discoverEfforts(modelKey) {
      const initial = currentEffort();
      if (initial.state === 'missing') {
        if (noEffortIsExplicit(menus()[0])) return { kind: 'none', options: [], current: null };
        return { kind: 'unknown', options: [], current: null, reason: '当前模型没有可识别的强度控件' };
      }
      if (initial.state !== 'range' || initial.max - initial.min > 9) {
        return { kind: 'unknown', options: [], current: null, reason: '强度范围无法安全识别' };
      }
      const label = canonicalEffortLabel(initial.accessibleLabel || initial.label);
      if (!label) return { kind: 'unknown', options: [], current: null, reason: '档位名称无法从当前页面状态确认' };
      const current = { value: initial.value, key: effortValueKey(modelKey, initial.value), label };
      return {
        kind: 'value',
        options: [current],
        current,
        reason: ''
      };
    }

    function currentModelPreference(saved, buttonText) {
      return resolveCurrentModelPreference(catalog, saved, buttonText);
    }

    function readCurrentPreferenceFromNative(check) {
      if (check) check();
      const button = picker();
      if (!button) throw new Error('找不到可读取的原生模型控件');
      const saved = prefs.ensure(key);
      const buttonText = readNativeModelText(button);
      const model = currentModelPreference(saved, buttonText);
      if (!model?.key || !model?.label) throw new Error('页面当前模型名称无法确认');
      const current = currentEffort();
      const statusText = current.menu ? readEffortStatus(current.menu).raw : current.statusText;
      const observationText = [current.accessibleLabel, statusText, buttonText].filter(Boolean).join(' · ');
      const preference = observeEffortPreference(
        { ...saved, modelKey: model.key, modelLabel: model.label },
        observationText,
        current
      );
      if (!preference) throw new Error('当前页面偏好无法识别');
      const effortState = preference.effortState === 'value'
        ? { kind: 'value', options: current.value === null ? [] : [{ value: current.value, key: preference.effortKey, label: preference.effortLabel }], current: current.value === null ? null : { value: current.value, key: preference.effortKey, label: preference.effortLabel } }
        : { kind: preference.effortState === 'none' ? 'none' : 'unknown', options: [], current: null, reason: '档位名称无法从当前页面状态确认' };
      if (check) check();
      return {
        unavailable: false,
        preference,
        observedEffortLabel: preference.observedEffortLabel || '',
        observation: {
          context: key,
          modelKey: model.key,
          modelLabel: model.label,
          effortValue: Number.isInteger(current.value) ? current.value : null,
          effortLabel: preference.observedEffortLabel || '',
          state: preference.observedEffortLabel ? 'label-observed' : 'unknown',
          source: current.accessibleLabel ? 'aria-valuetext' : current.menu ? 'menu-status' : 'model-control-text'
        },
        effortState,
        current
      };
    }

    function updateEffortUi(modelKey, result, observedLabel = '') {
      effortModelKey = modelKey;
      effortOptions = result.kind === 'value' ? result.options : [];
      effortObservedLabel = canonicalEffortLabel(observedLabel);
      renderPanel();
    }

    async function readCatalogOnly(check) {
      // 仅读取模型列表供展开态使用，不读取或探测档位。
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

    function chooseModel(item) {
      if (!item || item.disabled || item.availability?.state === 'unknown') return;
      route();
      pendingChoice = { modelKey: item.key, modelLabel: item.label, effortKey: null, effortLabel: '', effortState: 'unknown' };
      rememberConversationPreference(pendingChoice);
      verified = ''; blocked = '';
      status('等待空闲后应用所选模型');
      schedule(1500);
    }

    function chooseEffort(item, value) {
      if (!effortBackend.available) {
        blocked = 'backend-unavailable';
        status('档位修改受阻：' + effortBackend.reason);
        return;
      }
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
      verified = ''; blocked = '';
      status('等待空闲后应用所选档位');
      schedule(1500);
    }

    function renderPanel() {
      if (!panelUi) return;
      const current = confirmedPreference;
      panelUi.status.textContent = statusText;
      panelUi.controls.update({
        catalog,
        current,
        effortModelKey,
        effortOptions,
        observedEffortLabel: effortObservedLabel,
        writerAvailable: effortBackend.available,
        writerReason: effortBackend.reason,
        pendingChoice
      });
      const short = panelSummary(current, current);
      const summaryText = short.text || (panelSettings.collapsed ? '…' : '状态未确认');
      panelUi.short.textContent = summaryText;
      panelUi.short.title = short.text;
      panelUi.short.setAttribute('aria-label', short.text || summaryText);
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
      const viewport = { width: win.innerWidth, height: win.innerHeight };
      const panel = { width: rect.width, height: rect.height };
      refreshPositionAnchors();
      let requested = drag?.position || panelSettings.position;
      if (!requested) {
        const editor = composer();
        const voice = voiceButton();
        requested = panelSettings.collapsed
          ? preferredPanelPosition(viewport, panel, editor?.getBoundingClientRect(), voice?.getBoundingClientRect())
          : preferredExpandedPanelPosition(viewport, panel, editor?.getBoundingClientRect(), voice?.getBoundingClientRect());
      }
      const actual = clampPanelPosition(requested, viewport, panel);
      panelUi.host.style.right = actual.right + 'px';
      panelUi.host.style.bottom = actual.bottom + 'px';
    }

    function refreshPositionAnchors() {
      if (!positionAnchorObserver) return;
      const next = panelSettings.position ? new Set() : new Set([composer(), voiceButton()].filter(Boolean));
      for (const anchor of positionAnchors) {
        if (!next.has(anchor)) positionAnchorObserver.unobserve(anchor);
      }
      for (const anchor of next) {
        if (!positionAnchors.has(anchor)) positionAnchorObserver.observe(anchor);
      }
      positionAnchors = next;
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
      panelUi.host.dataset.collapsed = String(collapsed);
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
      if (win.ResizeObserver) {
        positionAnchorObserver = new win.ResizeObserver(() => {
          if (!panelSettings.position) queuePanelPosition();
        });
      }
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
      host.dataset.collapsed = String(panelSettings.collapsed);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = `
        :host { all: initial; position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; display: block; width: min(198px, calc(100vw - 16px)); color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        :host([data-collapsed="true"]) { width: max-content; max-width: min(148px, calc(100vw - 16px)); }
        * { box-sizing: border-box; }
        .panel { width: 100%; border: 1px solid rgba(255,255,255,.14); border-radius: 13px; background: rgba(25,28,34,.96); color: #f4f5f7; box-shadow: 0 8px 26px rgba(0,0,0,.28); backdrop-filter: blur(16px); cursor: grab; touch-action: manipulation; }
        .panel.is-dragging { cursor: grabbing; user-select: none; touch-action: none; }
        .header { display: flex; align-items: center; gap: 0; min-width: 0; min-height: 32px; padding: 2px 4px 2px 8px; border-radius: 12px 12px 0 0; }
        .short { flex: 0 1 auto; min-width: 0; max-width: calc(100vw - 42px); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #f5f7fb; font-size: 11px; font-weight: 600; letter-spacing: .01em; }
        :host(:not([data-collapsed="true"])) .short { flex: 1 1 auto; max-width: calc(100% - 28px); }
        .toggle { flex: none; width: 24px; height: 26px; min-height: 26px; margin-left: 2px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: #c9d5e4; font-size: 18px; font-weight: 700; line-height: 1; }
        .toggle:hover:not(:disabled) { background: rgba(137,183,255,.12); }
        .body { max-height: calc(100vh - 65px); overflow-y: auto; padding: 8px; border-top: 1px solid rgba(255,255,255,.08); }
        .body[hidden] { display: none; }
        .model-controls { display: grid; gap: 6px; min-width: 0; }
        .model-buttons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; min-width: 0; }
        .effort-buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; min-width: 0; }
        .model-choice, .effort-choice { min-width: 0; min-height: 28px; padding: 0 4px; border: 1px solid rgba(255,255,255,.10); border-radius: 8px; background: rgba(39,43,51,.76); color: #f4f5f7; font: inherit; font-size: 11px; font-weight: 600; text-align: center; white-space: nowrap; cursor: pointer; }
        .model-choice[aria-pressed="true"], .effort-choice[aria-pressed="true"] { border-color: rgba(130,184,255,.78); background: rgba(53,72,98,.72); color: #f7faff; }
        .effort-choice:nth-child(4) { grid-column: 1; }
        .model-choice:disabled, .effort-choice:disabled { opacity: .52; cursor: default; }
        .model-note, .effort-note { margin: 0; color: #bdc8d6; font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
        button:hover:not(:disabled), button:focus-visible, .header:focus-visible { border-color: #83b8ff; outline: 2px solid #83b8ff; outline-offset: 1px; }
        button:disabled { cursor: default; }
        .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
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
      const controls = createModelEffortControls(doc, chooseModel, chooseEffort);
      const storageNote = doc.createElement('p'); storageNote.className = 'storage-note'; storageNote.textContent = '无法保存面板位置和折叠状态';
      body.append(statusNode, controls.element, storageNote);
      panel.append(header, body);
      shadow.append(style, panel);
      doc.body.append(host);
      panelUi = { host, shadow, panel, dragSurface: panel, body, keyboardSurface: header, short, toggle, storageNote, controls, status: statusNode };
      setupPanelLayout();
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
      activeWriteController?.abort();
      activeWriteController = null;
      prefs.migrate(key, next, pendingSend, Date.now());
      key = next;
      pendingSend = null;
      pendingChoice = null;
      pendingNativeCapture = false;
      conversationPreference = null;
      confirmedPreference = null;
      verified = ''; blocked = ''; lastObservedButton = '';
      effortOptions = []; effortModelKey = ''; effortObservedLabel = '';
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
      activeWriteController?.abort();
      const path = elementsInPath(event);
      const insideNativeMenu = !!pathFind(path, '[role="menu"]');
      const modelItem = pathFind(path, '[role="menuitemradio"]');
      const strength = pathFind(path, '[role="slider"]');
      const panelControl = pathFind(path, '[data-chatgpt-panel-control]');
      const preserveFocusChoice = pathFind(path, '[data-chatgpt-preserve-focus]');
      if (shouldPreventPanelMouseFocus(event, preserveFocusChoice)) event.preventDefault();
      if (event.type === 'beforeinput' && /(?:dictat|speech|voice|transcrib|语音|听写)/i.test(event.inputType || '')) {
        voiceInputUntil = Date.now() + 2000;
      }
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
      const read = await readCurrentPreferenceFromNative(check);
      if (read.unavailable) {
        pendingNativeCapture = false;
        blocked = 'native-unavailable|' + read.model.key;
        status('不可用：' + read.reason + '；保留原偏好');
        return;
      }
      const preference = normalizePreference(read.preference);
      if (!preference) throw new Error('手动选择的模型偏好无法保存');
      pendingNativeCapture = false;
      pendingChoice = null;
      confirmedPreference = { ...preference, observedEffortLabel: read.observedEffortLabel || '' };
      updateEffortUi(preference.modelKey, read.effortState, read.observedEffortLabel);
      if (preference.effortState === 'unknown') {
        blocked = 'unknown-effort|' + preference.modelKey;
        status(read.observedEffortLabel
          ? '已读取当前档位 ' + read.observedEffortLabel + '；切换能力尚未确认'
          : '已读取模型，档位未识别；保留上次确认');
        return;
      }
      prefs.save(key, preference);
      rememberConversationPreference(preference);
      verified = targetSignature(preference, picker()?.textContent || '');
      blocked = '';
      status('已确认');
    }

    async function applyModelSelection(targetModel, check) {
      // 这里只保留既有的模型选择行为；档位读取和档位写入不会调用此路径。
      const modelState = await openModelOptions(check);
      let selected = modelState.selected;
      if (selected && selected.key === targetModel.key) {
        await closeOwnedMenus();
        return selected;
      }
      if (targetModel.disabled) throw new Error(targetModel.reason || '原生模型菜单限制了此模型');
      const element = modelState.elements.find(item => modelInfo(item).key === targetModel.key);
      if (!element || modelUnavailableReason(element)) throw new Error('原生模型菜单禁止选择此项');
      check();
      element.click();
      await delay(120);
      check();
      await closeOwnedMenus();
      const verifiedState = await openModelOptions(check);
      selected = verifiedState.selected;
      await closeOwnedMenus();
      if (!selected || selected.key !== targetModel.key) throw new Error('模型没有通过原生勾选状态确认');
      return selected;
    }

    function observedPreference(read) {
      const preference = normalizePreference(read.preference);
      if (!preference) throw new Error('当前页面偏好无法识别');
      if (preference.effortState === 'unknown' && confirmedPreference?.effortState === 'value' &&
          confirmedPreference.modelKey === preference.modelKey && Number.isInteger(read.current?.value) &&
          confirmedPreference.effortKey === effortValueKey(preference.modelKey, read.current.value)) {
        return {
          ...confirmedPreference,
          observedEffortLabel: read.observedEffortLabel || confirmedPreference.effortLabel
        };
      }
      return { ...preference, observedEffortLabel: read.observedEffortLabel || preference.effortLabel || '' };
    }

    async function writeEffortWithBackend(target, check) {
      if (!effortBackend.available) return { ok: false, reason: effortBackend.reason };
      const controller = new win.AbortController();
      activeWriteController = controller;
      try {
        return await confirmEffortWrite({
          adapter: effortBackend,
          target,
          payload: {
            context: key,
            modelKey: target.modelKey,
            modelLabel: target.modelLabel,
            effortKey: target.effortKey,
            effortLabel: target.effortLabel
          },
          check,
          readCurrent: () => readCurrentPreferenceFromNative(check),
          wait: delay,
          signal: controller.signal
        });
      } finally {
        if (activeWriteController === controller) activeWriteController = null;
      }
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
      status(pendingChoice ? '正在应用所选模型' : '正在读取页面档位');
      const epoch = serial, routeKey = key;
      const check = () => cancellationCheck(epoch, routeKey);
      let applied = false;
      try {
        if (pendingNativeCapture) {
          await captureNativePreference(check);
          applied = true;
          return;
        }

        let read = await readCurrentPreferenceFromNative(check);
        let actual = observedPreference(read);
        confirmedPreference = actual;
        updateEffortUi(actual.modelKey, read.effortState, read.observedEffortLabel);

        const modelChoice = requestedChoice?.effortState === 'unknown' ||
          (!requestedChoice && desired.modelKey !== actual.modelKey);
        if (modelChoice) {
          if (!catalog.length) {
            const modelState = await readCatalogOnly(check);
            catalog = modelState.items;
            renderPanel();
          }
          const targetModel = findModel(catalog, desired);
          if (!targetModel) throw new Error('原生菜单没有唯一匹配的目标模型');
          if (targetModel.disabled) throw new Error(targetModel.reason || '原生模型菜单限制了此模型');
          if (targetModel.key !== actual.modelKey) {
            await applyModelSelection(targetModel, check);
            await delay(120);
            read = await readCurrentPreferenceFromNative(check);
            actual = observedPreference(read);
            confirmedPreference = actual;
            updateEffortUi(actual.modelKey, read.effortState, read.observedEffortLabel);
            if (actual.modelKey !== targetModel.key) throw new Error('页面没有确认模型切换结果');
          }
          pendingChoice = null;
          if (actual.effortState !== 'unknown') {
            prefs.save(key, actual);
            rememberConversationPreference(actual);
          }
          applied = true;
        }

        const needsEffort = desired.effortState === 'value' && !preferenceMatches(actual, desired);
        if (needsEffort) {
          if (!effortBackend.available) {
            pendingChoice = null;
            blocked = 'backend-unavailable|' + signature;
            status('档位修改受阻：' + effortBackend.reason);
            applied = true;
            return;
          }
          const result = await writeEffortWithBackend(desired, check);
          if (!result.ok) {
            pendingChoice = null;
            blocked = effortBackend.available ? signature : 'backend-unavailable|' + signature;
            status('档位修改受阻：' + result.reason);
            return;
          }
          actual = result.preference;
          confirmedPreference = actual;
          updateEffortUi(actual.modelKey, result.read.effortState, result.read.observedEffortLabel);
          prefs.save(key, actual);
          if (requestedChoice) rememberConversationPreference(actual);
        }

        if (requestedChoice?.effortState === 'value') pendingChoice = null;
        if (requestedChoice && !needsEffort && requestedChoice.effortState === 'unknown') rememberConversationPreference(actual);
        confirmedPreference = actual;
        verified = targetSignature(actual, picker()?.textContent || '');
        blocked = actual.effortState === 'unknown' ? 'unknown-effort|' + actual.modelKey : '';
        status(actual.effortState === 'unknown'
          ? actual.observedEffortLabel
            ? '已读取当前档位 ' + actual.observedEffortLabel + '；档位修改受阻'
            : '已读取模型，档位未识别'
          : '已确认');
        applied = true;
      } catch (error) {
        try { check(); } catch (_) {
          blocked = ''; pendingChoice = null;
          status('用户开始操作或切换了聊天，脚本已让出控件');
          return;
        }
        blocked = targetSignature(desired, normalize(picker()?.textContent || ''));
        status('暂停：' + error.message);
        console.warn('[ChatGPT model preference]', error.message);
      } finally {
        await closeOwnedMenus();
        working = false;
        if (!applied && (pendingNativeCapture || pendingChoice)) schedule(1450);
        renderPanel();
      }
    }

    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup', 'click', 'beforeinput', 'input', 'change']) {
      doc.addEventListener(type, interaction, true);
    }
    doc.addEventListener('compositionstart', () => { composing = true; }, true);
    doc.addEventListener('compositionend', () => { composing = false; lastInput = Date.now(); schedule(1450); }, true);
    new win.MutationObserver(records => {
      if (panelUi && !panelUi.host.isConnected) mountPanel();
      let settingsChanged = false;
      for (const record of records) {
        if (record.type === 'attributes' && [
          'aria-valuenow', 'aria-valuetext', 'aria-checked', 'aria-expanded', 'aria-disabled',
          'aria-label', 'aria-description', 'aria-describedby', 'data-disabled', 'data-state', 'disabled', 'title'
        ].includes(record.attributeName)) {
          const target = record.target;
          if (target.closest?.('[role="menu"],button[aria-label*="模型"],button[aria-label*="model"]')) settingsChanged = true;
        }
        if ((record.type === 'childList' || record.type === 'characterData') &&
            (record.target.parentElement?.closest?.('[role="menu"]') || record.target.closest?.(PICKER))) settingsChanged = true;
      }
      const menuOpen = menus().length > 0;
      if (menuOpen) observeVisibleModelCatalog();
      if (settingsChanged && !menuOpen) schedule();
    }).observe(doc.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: [
        'aria-valuenow', 'aria-valuetext', 'aria-checked', 'aria-expanded', 'aria-disabled',
        'aria-label', 'aria-description', 'aria-describedby', 'data-disabled', 'data-state', 'disabled', 'title'
      ]
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
      if (!panelSettings.position) queuePanelPosition();
      const currentButton = normalize(picker()?.textContent || '');
      if (previousKey !== key || (lastObservedButton && currentButton !== lastObservedButton)) {
        verified = ''; blocked = '';
        schedule(250);
      }
      lastObservedButton = currentButton;
    }, 1500);
    prefs.ensure(key);
    mountPanel();
    observeVisibleModelCatalog();
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
    resolveCurrentModelPreference,
    effortLabelFromStatus,
    effortItemIndexFromStatus,
    canonicalEffortLabel,
    effortLabelFromText,
    panelModelSlot,
    panelEffortSlot,
    shouldPreventPanelMouseFocus,
    readVisibleModelCatalog,
    createModelEffortControls,
    observeEffortPreference,
    createEffortBackendAdapter,
    confirmEffortWrite,
    preferenceMatches,
    classifyModelAvailability,
    modelAvailabilityLabel,
    effortRowPresentation,
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
    preferredExpandedPanelPosition,
    preferredPanelPosition,
    panelSummary,
    resolveConversationPreference,
    resolveEffortLabel,
    start
  };
});
