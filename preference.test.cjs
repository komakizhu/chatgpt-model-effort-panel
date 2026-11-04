const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  Preferences,
  context,
  DEFAULT_PREFERENCE,
  effortLabelFromStatus,
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
  panelSummary
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

test('摘要区分目标、网页确认与不可用', () => {
  const wanted = DEFAULT_PREFERENCE;
  assert.deepEqual(panelSummary(wanted, wanted, '已确认', true), { text: 'GPT-5.6 Sol · Medium', state: '已确认' });
  assert.deepEqual(panelSummary(wanted, wanted, '等待空闲', false), { text: '目标：GPT-5.6 Sol · Medium', state: '等待' });
  assert.equal(panelSummary(wanted, null, '不可用：限额', false).state, '不可用');
  assert.equal(panelSummary(wanted, null, '暂停：无法识别', false).state, '未确认');
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
  assert.equal(effortLabelFromStatus('无项目序号的文字'), null);
  assert.equal(effortKey('Medium'), 'effort:medium');
  assert.equal(effortKey('极高'), 'effort:extra-high');
  assert.equal(effortKey('Experimental level'), 'label:experimental level');
});

test('每个模型按自己的滑杆范围生成档位，缺少名称时显示原生序号', () => {
  const four = buildEffortOptions('model:four', 0, 3, { 0: 'Low，第 1 项，共 4 项。', 1: 'Medium，第 2 项，共 4 项。', 2: 'High，第 3 项，共 4 项。', 3: 'Max，第 4 项，共 4 项。' });
  assert.equal(four.kind, 'value');
  assert.deepEqual(four.options.map(option => option.label), ['Low', 'Medium', 'High', 'Max']);
  const partial = buildEffortOptions('model:three', 0, 2, { 0: 'Low，第 1 项，共 3 项。', 1: '', 2: 'High，第 3 项，共 3 项。' });
  assert.deepEqual(partial.options.map(option => option.label), ['Low', '原生第 2 档', 'High']);
  assert.notEqual(four.options[0].key, effortValueKey('model:three', 0));
  assert.equal(buildEffortOptions('model:wide', 0, 10, {}).kind, 'unknown');
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
  assert.equal(createModelOption({ label: 'GPT-5.6 Sol' }).disabled, false);
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
