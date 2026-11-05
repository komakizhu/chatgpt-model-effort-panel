const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  Preferences,
  context,
  resolveCurrentModelPreference,
  DEFAULT_PREFERENCE,
  effortLabelFromStatus,
  effortItemIndexFromStatus,
  effortLabelFromText,
  observeEffortPreference,
  createEffortBackendAdapter,
  confirmEffortWrite,
  classifyModelAvailability,
  modelAvailabilityLabel,
  effortRowPresentation,
  effortKey,
  effortValueKey,
  findEffortOption,
  buildEffortOptions,
  createModelOption,
  isManualNativeAction,
  findModel,
  normalizePreference,
  isLimitHint,
  PANEL_KEY,
  normalizePanelSettings,
  readPanelSettings,
  clampPanelPosition,
  preferredExpandedPanelPosition,
  preferredPanelPosition,
  panelSummary,
  resolveConversationPreference,
  resolveEffortLabel,
  panelModelSlot,
  panelEffortSlot,
  shouldPreventPanelMouseFocus,
  readVisibleModelCatalog,
  createModelEffortControls
} = require('./ChatGPT_56_Preference.user.js');

function memory() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

const noop = () => {};

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentElement = null;
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.focusCalls = 0;
  }

  append(...elements) {
    for (const element of elements) {
      element.parentElement = this;
      this.children.push(element);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }

  click(isTrusted = true) {
    if (this.disabled) return;
    for (const callback of this.listeners.get('click') || []) {
      callback({ type: 'click', isTrusted, preventDefault() {} });
    }
  }

  focus() {
    this.focusCalls++;
  }
}

function testDocument() {
  return { createElement: tagName => new TestElement(tagName) };
}

function descendants(node) {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}

test('面板首次默认折叠，单独保存位置并读取', () => {
  const store = memory();
  assert.deepEqual(readPanelSettings(store), { settings: { collapsed: true, position: null }, available: true });
  store.setItem(PANEL_KEY, JSON.stringify({ collapsed: false, position: { right: 45, bottom: 80 } }));
  assert.deepEqual(readPanelSettings(store).settings, { collapsed: false, position: { right: 45, bottom: 80 } });
});

test('无效面板数据回退默认，存储不可用有独立状态', () => {
  const store = memory();
  store.setItem(PANEL_KEY, '{broken');
  assert.deepEqual(readPanelSettings(store), { settings: { collapsed: true, position: null }, available: true });
  assert.deepEqual(normalizePanelSettings({ collapsed: false, position: { right: -1, bottom: 2 } }),
    { collapsed: true, position: null });
  assert.equal(readPanelSettings({ getItem() { throw new Error('blocked'); } }).available, false);
});

test('面板位置按视口和展开后的高度限制，原始偏好不变', () => {
  const desired = { right: 400, bottom: 500 };
  assert.deepEqual(clampPanelPosition(null, { width: 800, height: 600 }, { width: 290, height: 40 }), { right: 12, bottom: 12 });
  assert.deepEqual(clampPanelPosition(desired, { width: 400, height: 300 }, { width: 290, height: 200 }), { right: 110, bottom: 100 });
  assert.deepEqual(desired, { right: 400, bottom: 500 });
  assert.deepEqual(clampPanelPosition({ right: -4, bottom: -8 }, { width: 200, height: 100 }, { width: 290, height: 200 }), { right: 0, bottom: 0 });
});

test('面板默认停靠在录音按钮右侧的留白处', () => {
  const position = preferredPanelPosition(
    { width: 1324, height: 1024 },
    { width: 148, height: 32 },
    { top: 680 },
    { left: 1080, right: 1125, top: 980, bottom: 1012 }
  );
  assert.deepEqual(position, { right: 12, bottom: 12 });
  assert.ok(1324 - position.right - 148 >= 1125 + 12);
  assert.equal(position.bottom, 12);
});

test('展开态仍停在输入栏上方并避开录音按钮', () => {
  const position = preferredExpandedPanelPosition(
    { width: 1024, height: 768 },
    { width: 198, height: 180 },
    { top: 640 },
    { left: 880, right: 920, top: 700, bottom: 732 }
  );
  assert.deepEqual(position, { right: 156, bottom: 140 });
});

test('折叠摘要只显示网页已核对的模型与强度', () => {
  const wanted = DEFAULT_PREFERENCE;
  assert.deepEqual(panelSummary(wanted, wanted), { text: 'GPT-5.6 · Medium', state: '' });
  const unknown = { ...wanted, effortKey: null, effortLabel: '', effortState: 'unknown' };
  assert.deepEqual(panelSummary(unknown, unknown), { text: 'GPT-5.6 · 档位未识别', state: '' });
  assert.deepEqual(panelSummary(wanted, { ...unknown, observedEffortLabel: 'High' }), { text: 'GPT-5.6 · High', state: '' });
  assert.deepEqual(panelSummary(wanted, null), { text: '', state: '' });
});

test('当前会话的用户选择优先于默认值，切换会话后才回到保存值', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const userChoice = { ...saved, effortKey: effortValueKey(saved.modelKey, 3), effortLabel: 'Extra High' };
  assert.equal(resolveConversationPreference(saved, null, null), saved);
  assert.equal(resolveConversationPreference(saved, userChoice, saved).effortKey, userChoice.effortKey);
  assert.equal(resolveConversationPreference(saved, null, userChoice).effortKey, userChoice.effortKey);
});

test('强度标签不会用滞后的原生状态覆盖已确认档位', () => {
  assert.equal(resolveEffortLabel('Extra High', 'Medium'), 'Extra High');
  assert.equal(resolveEffortLabel('极高', 'Extra High'), 'Extra High');
  assert.equal(resolveEffortLabel('原生第 4 档', 'Extra High'), 'Extra High');
  assert.equal(resolveEffortLabel('Medium', 'Medium'), 'Medium');
});

test('快捷档位只把 Medium 和 Extra High 显示为 Mid 和 X High，Max 不冒充 Pro', () => {
  assert.equal(panelEffortSlot('Medium').label, 'Mid');
  assert.equal(panelEffortSlot('Mid').canonical, 'Medium');
  assert.equal(panelEffortSlot('Extra High').label, 'X High');
  assert.equal(panelEffortSlot('X High').canonical, 'Extra High');
  assert.equal(panelEffortSlot('Pro').label, 'Pro');
  assert.equal(panelEffortSlot('Max'), null);
  assert.equal(panelModelSlot('GPT-5.6 Sol').label, 'GPT-5.6');
  assert.equal(panelModelSlot('GPT-6').label, 'GPT-6');
  assert.equal(panelModelSlot('GPT-6 Thinking'), null);
});

test('展开面板实际渲染固定模型和强度按钮，并只按页面确认状态选中', () => {
  const modelSelections = [];
  const effortSelections = [];
  const controls = createModelEffortControls(testDocument(),
    model => modelSelections.push(model),
    (model, effortKey) => effortSelections.push({ model, effortKey }));
  const current = { ...DEFAULT_PREFERENCE };
  const gpt56 = createModelOption({ key: current.modelKey, label: 'GPT-5.6 Sol' });
  const gpt6 = createModelOption({ stableId: 'gpt-6', label: 'GPT-6', reason: '已锁定访问权限；已达到使用限额' });
  const medium = { key: effortValueKey(current.modelKey, 1), value: 1, label: 'Medium' };
  const originalNodes = descendants(controls.element);

  controls.update({
    catalog: [gpt56, gpt6],
    current,
    effortModelKey: current.modelKey,
    effortOptions: [medium],
    observedEffortLabel: 'Medium',
    writerAvailable: false,
    writerReason: '未发现可确认的同源档位接口'
  });

  assert.deepEqual([...controls.modelButtons.values()].map(button => button.textContent), ['GPT-5.6', 'GPT-6']);
  assert.deepEqual([...controls.effortButtons.values()].map(button => button.textContent), ['Low', 'Mid', 'High', 'X High', 'Pro']);
  assert.equal(controls.modelButtons.get('gpt-5.6').getAttribute('aria-pressed'), 'true');
  assert.equal(controls.modelButtons.get('gpt-6').disabled, true);
  assert.match(controls.modelNotice.textContent, /GPT-6：.*访问权限.*使用限额/);
  assert.equal(controls.effortButtons.get('medium').getAttribute('aria-pressed'), 'true');
  assert.equal(controls.effortButtons.get('medium').disabled, true);
  assert.match(controls.effortNotice.textContent, /档位修改受阻/);
  assert.equal(controls.effortButtons.get('pro').disabled, true);
  assert.match(controls.effortButtons.get('pro').title, /选项未确认/);
  assert.equal(descendants(controls.element).some(node => node.tagName === 'SELECT'), false);

  controls.modelButtons.get('gpt-6').click();
  controls.effortButtons.get('medium').click();
  assert.equal(modelSelections.length, 0);
  assert.equal(effortSelections.length, 0);

  controls.update({
    catalog: [gpt56, gpt6],
    current: { ...current, effortLabel: 'Extra High', effortKey: effortValueKey(current.modelKey, 3) },
    effortModelKey: current.modelKey,
    effortOptions: [{ key: effortValueKey(current.modelKey, 3), value: 3, label: 'Extra High' }],
    observedEffortLabel: 'Extra High',
    writerAvailable: true,
    writerReason: ''
  });
  assert.equal(controls.effortButtons.get('extra-high').getAttribute('aria-pressed'), 'true');
  assert.equal(controls.effortButtons.get('pro').disabled, true);
  const updatedNodes = descendants(controls.element);
  assert.equal(updatedNodes.length, originalNodes.length);
  originalNodes.forEach((node, index) => assert.strictEqual(updatedNodes[index], node));
  assert.equal(descendants(controls.element).some(node => node.focusCalls > 0), false);

  controls.update({
    catalog: [gpt56, gpt6],
    current: { ...current, effortLabel: 'Max', effortKey: effortValueKey(current.modelKey, 4) },
    effortModelKey: current.modelKey,
    effortOptions: [{ key: effortValueKey(current.modelKey, 4), value: 4, label: 'Max' }],
    observedEffortLabel: 'Max',
    writerAvailable: true,
    writerReason: ''
  });
  assert.equal(controls.effortButtons.get('pro').getAttribute('aria-pressed'), 'false');
  assert.equal(controls.effortButtons.get('pro').disabled, true);
  assert.match(controls.effortButtons.get('pro').title, /选项未确认/);
});

test('打开的原生模型菜单只读采集真实模型项目，不点击菜单或选项', () => {
  let clicks = 0, reads = 0;
  const elements = [
    { label: 'GPT-5.6 Sol', key: 'model:56', click() { clicks++; } },
    { label: 'GPT-6', key: 'model:6', reason: '已达到使用限额', click() { clicks++; } }
  ];
  const menu = {
    querySelectorAll(selector) {
      assert.equal(selector, '[role="menuitemradio"]');
      return elements;
    }
  };
  const items = readVisibleModelCatalog([menu], element => {
    reads++;
    return { ...element };
  }, () => true);
  assert.deepEqual(items.map(item => item.label), ['GPT-5.6 Sol', 'GPT-6']);
  assert.equal(reads, 2);
  assert.equal(clicks, 0);
  assert.deepEqual(readVisibleModelCatalog([], () => { throw new Error('不应读取'); }, () => true), []);
});

test('鼠标点击模型或强度按钮可阻止浏览器把焦点从输入框移走', () => {
  let prevented = false;
  const control = {};
  const pointer = {
    type: 'pointerdown', button: 0, cancelable: true,
    preventDefault() { prevented = true; }
  };
  assert.equal(shouldPreventPanelMouseFocus(pointer, control), true);
  pointer.preventDefault();
  assert.equal(prevented, true);
  assert.equal(shouldPreventPanelMouseFocus({ ...pointer, button: 2 }, control), false);
  assert.equal(shouldPreventPanelMouseFocus({ ...pointer, cancelable: false }, control), false);
  assert.equal(shouldPreventPanelMouseFocus({ ...pointer, type: 'keydown' }, control), false);
});

test('初始默认组合为 GPT-5.6 Sol + Medium', () => {
  const prefs = new Preferences(memory(), memory());
  assert.deepEqual(prefs.readDefault(), DEFAULT_PREFERENCE);
  assert.deepEqual(prefs.ensure('chat:a'), DEFAULT_PREFERENCE);
});

test('聊天偏好跨重载保存且互不覆盖', () => {
  const local = memory();
  const first = new Preferences(local, memory());
  const modelKey = 'label:gpt-5.6 sol';
  first.save('chat:a', { modelKey, modelLabel: 'GPT-5.6 Sol', effortKey: effortValueKey(modelKey, 3), effortLabel: '极高', effortState: 'value' });
  const second = new Preferences(local, memory());
  assert.equal(second.ensure('chat:a').effortKey, effortValueKey(modelKey, 3));
  assert.equal(second.ensure('chat:b').effortKey, effortValueKey(modelKey, 1));
});

test('全局默认只影响之后首次进入的聊天', () => {
  const prefs = new Preferences(memory(), memory());
  prefs.ensure('chat:existing');
  const changed = { modelKey: 'model:new', modelLabel: 'New Model', effortKey: effortValueKey('model:new', 2), effortLabel: 'High', effortState: 'value' };
  prefs.setDefault(changed);
  assert.equal(prefs.ensure('chat:existing').modelKey, 'label:gpt-5.6 sol');
  assert.equal(prefs.ensure('chat:new').modelKey, 'model:new');
});

test('未识别强度不能设为默认，但可以保留为聊天状态', () => {
  const prefs = new Preferences(memory(), memory());
  const unknown = { modelKey: 'model:unknown', modelLabel: 'Unknown', effortKey: null, effortLabel: '', effortState: 'unknown' };
  prefs.save('chat:a', unknown);
  assert.equal(prefs.ensure('chat:a').effortState, 'unknown');
  assert.throws(() => prefs.setDefault(unknown), /已确认/);
  const noEffort = { ...unknown, effortState: 'none' };
  assert.equal(prefs.setDefault(noEffort).effortState, 'none');
});

test('旧版 0–4 档位只迁移到 GPT-5.6 Sol 并保留旧键', () => {
  const local = memory();
  for (let level = 0; level <= 4; level++) {
    const session = memory();
    const prefs = new Preferences(local, session);
    session.setItem('chatgpt-56-preference-v1:draft:/', JSON.stringify({ level }));
    const migrated = prefs.ensure('draft:/');
    assert.equal(migrated.modelLabel, 'GPT-5.6 Sol');
    assert.equal(migrated.effortKey, effortValueKey('label:gpt-5.6 sol', level));
    assert.notEqual(session.getItem('chatgpt-56-preference-v1:draft:/'), null);
  }
});

test('新聊天草稿只在明确发送后关联到会话', () => {
  const prefs = new Preferences(memory(), memory());
  const modelKey = 'label:gpt-5.6 sol';
  prefs.save('draft:/', { modelKey, modelLabel: 'GPT-5.6 Sol', effortKey: effortValueKey(modelKey, 2), effortLabel: 'High', effortState: 'value' });
  prefs.migrate('draft:/', 'chat:sent', { from: 'draft:/', time: 100 }, 200);
  assert.equal(prefs.ensure('chat:sent').effortKey, effortValueKey(modelKey, 2));
  assert.equal(prefs.read('draft:/'), null);
});

test('未知会话不迁移临时偏好', () => {
  const prefs = new Preferences(memory(), memory());
  const modelKey = 'label:gpt-5.6 sol';
  prefs.save('draft:/', { modelKey, modelLabel: 'GPT-5.6 Sol', effortKey: effortValueKey(modelKey, 4), effortLabel: 'Max', effortState: 'value' });
  prefs.migrate('draft:/', 'chat:opened-without-send');
  assert.equal(prefs.read('chat:opened-without-send'), null);
  assert.equal(prefs.read('draft:/').effortKey, effortValueKey(modelKey, 4));
});

test('模型切换时已保存的聊天档位不会被临时草稿覆盖', () => {
  const prefs = new Preferences(memory(), memory());
  prefs.save('draft:/', { modelKey: 'model:draft', modelLabel: 'Draft', effortKey: effortValueKey('model:draft', 2), effortLabel: 'High', effortState: 'value' });
  prefs.save('chat:existing', { modelKey: 'model:existing', modelLabel: 'Existing', effortKey: effortValueKey('model:existing', 4), effortLabel: 'Max', effortState: 'value' });
  prefs.migrate('draft:/', 'chat:existing');
  assert.equal(prefs.ensure('chat:existing').effortKey, effortValueKey('model:existing', 4));
});

test('中英文原生强度状态解析成可读标签', () => {
  assert.equal(effortLabelFromStatus('Medium，第 2 项，共 5 项。'), 'Medium');
  assert.equal(effortLabelFromStatus('Extra High, item 4 of 5.'), 'Extra High');
  assert.equal(effortLabelFromText('GPT-5.6 · 中'), 'Medium');
  assert.equal(effortLabelFromText('GPT-5.6 · Mid'), 'Medium');
  assert.equal(effortLabelFromText('GPT-5.6 · X High'), 'Extra High');
  assert.equal(effortLabelFromText('GPT-6 · Extra High'), 'Extra High');
  assert.equal(effortItemIndexFromStatus('Medium，第 2 项，共 5 项。'), 2);
  assert.equal(effortItemIndexFromStatus('Extra High, item 4 of 5.'), 4);
  assert.equal(effortLabelFromStatus('无项目序号的文字'), null);
  assert.equal(effortKey('Medium'), 'effort:medium');
  assert.equal(effortKey('极高'), 'effort:extra-high');
  assert.equal(effortKey('Experimental level'), 'label:experimental level');
});

test('每个模型按自己的滑杆范围生成档位，缺少名称时保持未识别', () => {
  const four = buildEffortOptions('model:four', 0, 3, { 0: 'Low，第 1 项，共 4 项。', 1: 'Medium，第 2 项，共 4 项。', 2: 'High，第 3 项，共 4 项。', 3: 'Max，第 4 项，共 4 项。' });
  assert.equal(four.kind, 'value');
  assert.deepEqual(four.options.map(option => option.label), ['Low', 'Medium', 'High', 'Max']);
  const partial = buildEffortOptions('model:three', 0, 2, { 0: 'Low，第 1 项，共 3 项。', 1: '', 2: 'High，第 3 项，共 3 项。' });
  assert.equal(partial.kind, 'unknown');
  assert.deepEqual(partial.options, []);
  assert.equal(buildEffortOptions('model:wrong', 0, 1, { 0: 'Medium，第 2 项，共 2 项。', 1: 'High，第 2 项，共 2 项。' }).reason, '档位文案与当前值不一致');
  assert.notEqual(four.options[0].key, effortValueKey('model:three', 0));
  assert.equal(buildEffortOptions('model:wide', 0, 10, {}).kind, 'unknown');
});

test('真实页面文案与滑杆序号一致时才确认档位', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const observed = observeEffortPreference(saved, 'Medium，第 2 项，共 5 项。', {
    state: 'range', value: 1, min: 0, max: 4, itemIndex: 2, accessibleLabel: ''
  });
  assert.equal(observed.effortState, 'value');
  assert.equal(observed.effortLabel, 'Medium');
  assert.equal(observed.effortKey, effortValueKey(saved.modelKey, 1));
  const mismatch = observeEffortPreference(saved, 'High，第 3 项，共 5 项。', {
    state: 'range', value: 1, min: 0, max: 4, itemIndex: 3, accessibleLabel: ''
  });
  assert.equal(mismatch.effortState, 'unknown');
  assert.equal(mismatch.effortLabel, '');
});

test('没有滑杆数值时只在文案与已保存真实档位一致时复用会话键', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const same = observeEffortPreference(saved, 'GPT-5.6 · 中', { state: 'missing', value: null, min: null, itemIndex: null });
  assert.equal(same.effortState, 'value');
  assert.equal(same.effortLabel, 'Medium');
  const migrated = observeEffortPreference({ ...saved, effortLabel: '原生第 2 档' }, 'GPT-5.6 · Medium', {
    state: 'missing', value: null, min: null, itemIndex: null
  });
  assert.equal(migrated.effortState, 'value');
  assert.equal(migrated.effortLabel, 'Medium');
  const changed = observeEffortPreference({ ...saved, effortLabel: 'High', effortKey: effortValueKey(saved.modelKey, 2) }, 'GPT-5.6 · 中', {
    state: 'missing', value: null, min: null, itemIndex: null
  });
  assert.equal(changed.effortState, 'unknown');
  assert.equal(changed.observedEffortLabel, 'Medium');
  assert.deepEqual(panelSummary(saved, changed), { text: 'GPT-5.6 · Medium', state: '' });
});

test('后端适配器没有确认契约时明确阻塞，假的契约可验证失败边界', async () => {
  const blocked = createEffortBackendAdapter();
  assert.equal(blocked.available, false);
  assert.equal(blocked.canRead, false);
  assert.equal(blocked.canWrite, false);
  assert.equal((await blocked.write({})).ok, false);
  const calls = [];
  const adapter = createEffortBackendAdapter({
    async read(payload) { calls.push(['read', payload]); return { ok: true, value: 'Medium' }; },
    async write(payload) { calls.push(['write', payload]); return { ok: true, value: 'High' }; }
  });
  assert.equal(adapter.available, true);
  assert.equal(adapter.canRead, true);
  assert.equal(adapter.canWrite, true);
  assert.deepEqual(await adapter.read({ context: 'chat:a' }), { ok: true, value: 'Medium' });
  assert.deepEqual(await adapter.write({ context: 'chat:a' }), { ok: true, value: 'High' });
  assert.deepEqual(calls.map(call => call[0]), ['read', 'write']);
  const invalid = createEffortBackendAdapter({
    async read() { return { value: 'Medium' }; },
    async write() { throw new Error('权限不足'); }
  });
  assert.deepEqual(await invalid.read({}), { ok: false, reason: '后端响应无法确认' });
  assert.deepEqual(await invalid.write({}), { ok: false, reason: '权限不足' });
  const reader = createEffortBackendAdapter({ async read() { return { ok: true }; } });
  assert.equal(reader.canRead, true);
  assert.equal(reader.canWrite, false);
  assert.deepEqual(await reader.write({}), { ok: false, reason: '未发现可确认的同源档位接口' });
});

test('写入只在页面于 5 秒内确认同一模型与档位后成功，失败时不提交偏好', async () => {
  const modelKey = DEFAULT_PREFERENCE.modelKey;
  const target = {
    ...DEFAULT_PREFERENCE,
    effortKey: effortValueKey(modelKey, 3),
    effortLabel: 'Extra High'
  };
  let clock = 0;
  let pagePreference = DEFAULT_PREFERENCE;
  let saved = null;
  const adapter = createEffortBackendAdapter({
    async write() { return { ok: true }; }
  });
  const success = await confirmEffortWrite({
    adapter,
    target,
    payload: { context: 'chat:a', modelKey, effortKey: target.effortKey },
    check: noop,
    now: () => clock,
    wait: async ms => {
      clock += ms;
      if (clock >= 300) pagePreference = target;
    },
    readCurrent: async () => ({ preference: pagePreference })
  });
  if (success.ok) saved = success.preference;
  assert.equal(success.ok, true);
  assert.equal(saved.effortLabel, 'Extra High');

  clock = 0;
  pagePreference = DEFAULT_PREFERENCE;
  saved = null;
  const timeout = await confirmEffortWrite({
    adapter,
    target,
    payload: { context: 'chat:a', modelKey, effortKey: target.effortKey },
    check: noop,
    now: () => clock,
    wait: async ms => { clock += ms; },
    readCurrent: async () => ({ preference: pagePreference })
  });
  if (timeout.ok) saved = timeout.preference;
  assert.equal(timeout.ok, false);
  assert.equal(timeout.reason, '页面未在 5 秒内确认切换结果');
  assert.equal(saved, null);

  const controller = new AbortController();
  let receivedSignal = null;
  const cancellable = createEffortBackendAdapter({
    async write(_payload, options) {
      receivedSignal = options.signal;
      controller.abort();
      return { ok: true };
    }
  });
  const cancelled = await confirmEffortWrite({
    adapter: cancellable,
    target,
    payload: { context: 'chat:a', modelKey, effortKey: target.effortKey },
    check: noop,
    signal: controller.signal,
    readCurrent: async () => ({ preference: target })
  });
  assert.equal(receivedSignal, controller.signal);
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.reason, '档位修改已取消');
});

test('档位逻辑不再聚焦原生滑杆或派发合成方向键', () => {
  const source = fs.readFileSync('ChatGPT_56_Preference.user.js', 'utf8');
  assert.doesNotMatch(source, /function\s+moveSliderTo\b/);
  assert.doesNotMatch(source, /new\s+win\.KeyboardEvent/);
  assert.doesNotMatch(source, /state\.control\.focus\s*\(/);
  assert.doesNotMatch(source, /oldFocus\.focus\s*\(/);
  assert.match(source, /shouldPreventPanelMouseFocus\(event, preserveFocusChoice\)/);
  const effortReader = source.slice(source.indexOf('const readNativeModelText'), source.indexOf('const menus'));
  assert.doesNotMatch(effortReader, /parentElement|\.click\s*\(/);
  const passiveRead = source.slice(source.indexOf('function readCurrentPreferenceFromNative'), source.indexOf('function updateEffortUi'));
  assert.doesNotMatch(passiveRead, /\.click\s*\(/);
  assert.match(source, /未发现可确认的同源档位接口/);
  const chooseEffort = source.slice(source.indexOf('function chooseEffort'), source.indexOf('function renderPanel'));
  assert.doesNotMatch(chooseEffort, /rememberConversationPreference/);
  const reconcile = source.slice(source.indexOf('async function reconcile'), source.indexOf("for (const type of ['pointerdown'"));
  assert.match(reconcile, /if \(modelChoice\)[\s\S]*?readCatalogOnly/);
  assert.doesNotMatch(source, /pendingCatalogRefresh/);
  const catalogReader = source.slice(source.indexOf('function observeVisibleModelCatalog'), source.indexOf('function isChooser'));
  assert.match(catalogReader, /menus\(\)/);
  assert.match(catalogReader, /readVisibleModelCatalog/);
  assert.doesNotMatch(catalogReader, /\.click\s*\(/);
  const panelCreation = source.slice(source.indexOf('function mountPanel'), source.indexOf('function schedule'));
  assert.doesNotMatch(panelCreation, /☆|⌖|↻|设为新聊天默认|重新读取原生控件|resetPosition|saveDefault|refresh|createElement\(['"]select/);
  assert.match(source, /observeVisibleModelCatalog\(\)/);
});

test('旧版按名称保存的档位只在同模型中按原生标签迁移', () => {
  const modelKey = 'model:legacy';
  const options = buildEffortOptions(modelKey, 0, 2, {
    0: 'Low，第 1 项，共 3 项。',
    1: 'Medium，第 2 项，共 3 项。',
    2: 'High，第 3 项，共 3 项。'
  }).options;
  assert.equal(findEffortOption(options, { modelKey, effortKey: 'effort:medium', effortLabel: 'Medium' }).value, 1);
  assert.equal(findEffortOption(options, { modelKey: 'model:other', effortKey: 'effort:medium', effortLabel: 'Medium' }), null);
});

test('档位选项以模型和原生滑杆位置组成独立标识', () => {
  const first = buildEffortOptions('model:a', 0, 1, { 0: 'High，第 1 项，共 2 项。', 1: 'High，第 2 项，共 2 项。' });
  const second = buildEffortOptions('model:b', 0, 1, { 0: 'High，第 1 项，共 2 项。', 1: 'High，第 2 项，共 2 项。' });
  assert.notEqual(first.options[0].key, first.options[1].key);
  assert.notEqual(first.options[0].key, second.options[0].key);
});

test('原生没有强度控件与控件未识别分别保留状态', () => {
  const base = { modelKey: 'model:x', modelLabel: 'Model X', effortKey: null, effortLabel: '' };
  assert.equal(normalizePreference({ ...base, effortState: 'none' }).effortState, 'none');
  assert.equal(normalizePreference({ ...base, effortState: 'unknown' }).effortState, 'unknown');
  assert.equal(normalizePreference({ ...base, effortState: 'value' }), null);
});

test('模型稳定 ID 优先，缺失 ID 时按完整名称区分', () => {
  const stable = createModelOption({ stableId: 'model-123', label: 'GPT-6', checked: true });
  const fallback = createModelOption({ label: 'GPT-5.6 Sol', category: '推理模型' });
  assert.equal(stable.key, 'id:model-123');
  assert.equal(fallback.key, 'label:gpt-5.6 sol');
  assert.equal(fallback.category, '推理模型');
  assert.equal(findModel([stable, fallback], { modelKey: 'old-key', modelLabel: 'GPT-5.6 Sol' }).key, fallback.key);
});

test('目录尚未读取时也能用保存的模型字段构造当前观察值', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const fallback = resolveCurrentModelPreference([], saved, 'GPT-5.6 · Medium');
  assert.equal(fallback.key, saved.modelKey);
  assert.equal(fallback.label, saved.modelLabel);
  const actualGpt6 = resolveCurrentModelPreference([], saved, 'GPT-6 · Medium');
  assert.equal(actualGpt6.label, 'GPT-6');
  assert.notEqual(actualGpt6.key, saved.modelKey);
  assert.equal(resolveCurrentModelPreference([], saved, 'Medium'), null);
  const savedThinking = {
    ...saved,
    modelKey: 'label:gpt-6 thinking',
    modelLabel: 'GPT-6 Thinking'
  };
  const actualThinking = resolveCurrentModelPreference([], savedThinking, 'GPT-6 Thinking · Medium');
  assert.equal(actualThinking.key, savedThinking.modelKey);
  const thinkingFromDefault = resolveCurrentModelPreference([], saved, 'GPT-6 Thinking · Medium');
  assert.equal(thinkingFromDefault.label, 'GPT-6 Thinking');
  assert.notEqual(thinkingFromDefault.key, saved.modelKey);
  const catalog = [
    createModelOption({ label: 'GPT-6', stableId: 'gpt-6' }),
    createModelOption({ label: 'GPT-6 Thinking', stableId: 'gpt-6-thinking' }),
    createModelOption({ label: 'GPT-5.6 Sol', stableId: 'gpt-56' })
  ];
  assert.equal(resolveCurrentModelPreference(catalog, saved, 'GPT-6 Thinking · Medium').key, 'id:gpt-6-thinking');
  assert.equal(resolveCurrentModelPreference([catalog[0]], saved, 'GPT-6 Thinking · Medium').label, 'GPT-6 Thinking');
  assert.equal(resolveCurrentModelPreference(catalog, saved, '5.6 中').key, 'id:gpt-56');
});

test('只有用户可信的模型与强度操作会被识别为手动选择', () => {
  assert.equal(isManualNativeAction({ isTrusted: true, type: 'pointerdown' }, 'model'), true);
  assert.equal(isManualNativeAction({ isTrusted: true, type: 'keydown', key: 'Enter' }, 'model'), true);
  assert.equal(isManualNativeAction({ isTrusted: true, type: 'keydown', key: 'ArrowRight' }, 'effort'), true);
  assert.equal(isManualNativeAction({ isTrusted: false, type: 'click' }, 'model'), false);
  assert.equal(isManualNativeAction({ isTrusted: false, type: 'keydown', key: 'ArrowRight' }, 'effort'), false);
  assert.equal(isManualNativeAction({ isTrusted: true, type: 'change' }, 'model'), false);
});

test('账号限额和权限提示会使模型不可用', () => {
  const model = createModelOption({ label: 'GPT-6', reason: '已锁定，打开访问权限选项；已达到使用限额' });
  assert.equal(isLimitHint(model.reason), true);
  assert.equal(model.disabled, true);
  assert.equal(model.availability.state, 'limited-and-permission');
  assert.equal(modelAvailabilityLabel(model), '已锁定，打开访问权限选项；已达到使用限额');
  assert.equal(classifyModelAvailability('已达到使用限额').state, 'limited');
  assert.equal(classifyModelAvailability('需要访问权限').state, 'permission');
  assert.equal(classifyModelAvailability('').state, 'available');
  assert.equal(createModelOption({ label: 'GPT-5.6 Sol' }).disabled, false);
});

test('GPT-5.6 当前名称可见，但没有选项或写入契约时诚实地禁用切换', () => {
  const row = effortRowPresentation({
    selected: true,
    model: createModelOption({ label: 'GPT-5.6 Sol' }),
    observedLabel: 'Medium',
    options: [],
    writerAvailable: false
  });
  assert.deepEqual(row, {
    label: 'Medium',
    disabled: true,
    title: '档位修改受阻：未发现可确认的同源档位接口'
  });
});

test('重复模型标识无法由精确查找器猜测', () => {
  const a = createModelOption({ label: 'Duplicate', stableId: 'same' });
  const b = createModelOption({ label: 'Duplicate 2', stableId: 'same' });
  assert.equal(findModel([a, b], { modelKey: 'id:same', modelLabel: 'Duplicate' }), null);
});

test('ChatGPT 路由能解析普通会话、项目会话和新草稿', () => {
  assert.equal(context('/c/abc-123'), 'chat:abc-123');
  assert.equal(context('/g/project/c/abc'), 'chat:abc');
  assert.equal(context('/'), 'draft:/');
  assert.equal(context('/g/project'), 'draft:/g/project');
});
