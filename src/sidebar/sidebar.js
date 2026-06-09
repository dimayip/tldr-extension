/**
 * TLDR Chrome插件 - 侧边栏主逻辑
 * 功能：摘要生成、AI对话、笔记管理（摘要已合并到对话流）
 */

// ===== 状态管理 =====
const state = {
  currentTab: 'chat',
  pageContent: null,
  pageInfo: null,
  chatHistory: [],
  notes: [],
  isLoading: false,
  settings: null,
  tabId: null,
  abortController: null,
  autoSummaryDone: false,
  translateEnabled: false,
  windowId: null
};

// ===== DOM元素引用 =====
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ===== 初始化 =====
async function init() {
  // 1) 同步绑定事件，UI 立即可交互
  bindEvents();
  loadNotes();

  // 2) 并行加载设置 + 当前标签页信息（避免串行等待 service worker 冷启动）
  const [, ] = await Promise.all([
    loadSettingsDirect(),
    loadActiveTab()
  ]);

  // 监听 tab 切换 / 同 tab 内页面变更
  setupTabListeners();

  // 3) 异步获取页面内容、同步翻译状态、检查待处理选区，不阻塞首屏
  syncTranslateStatus();
  await loadPageContent();

  // 检查是否有待处理的选中文本
  const hasPending = await checkPendingSelection();

  // 没有待处理选区时，按设置自动生成摘要（默认开启，不阻塞 UI，可取消）
  const autoEnabled = state.settings?.autoSummarize !== false;
  if (!hasPending && autoEnabled && state.pageContent && hasApiKey()) {
    state.autoSummaryDone = true;
    generateSummary({ auto: true });
  }
}

/**
 * 直接读取 chrome.storage.sync，避免走 background service worker（更快）
 */
function loadSettingsDirect() {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get(null, (data) => {
        state.settings = data || {};
        resolve();
      });
    } catch (_) {
      state.settings = {};
      resolve();
    }
  });
}

/**
 * 获取当前活动标签页
 */
async function loadActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      state.tabId = tabs[0].id;
      state.windowId = tabs[0].windowId;
      state.pageInfo = { title: tabs[0].title, url: tabs[0].url };
      updatePageInfo();
    }
  } catch (err) {
    console.warn('[TLDR] 获取标签页失败:', err);
  }
}

// ===== Tab 切换 / 页面变更监听 =====
let _tabSwitchTimer = null;
let _tabUpdateTimer = null;

function setupTabListeners() {
  try {
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    if (chrome.windows?.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
    }
  } catch (err) {
    console.warn('[TLDR] 注册 tab 监听失败:', err);
  }
}

async function handleTabActivated({ tabId, windowId }) {
  // 仅响应当前侧边栏所在窗口
  if (state.windowId && windowId && windowId !== state.windowId) return;
  if (tabId === state.tabId) return;
  clearTimeout(_tabSwitchTimer);
  _tabSwitchTimer = setTimeout(() => switchToTab(tabId), 80);
}

function handleTabUpdated(tabId, changeInfo, tab) {
  if (tabId !== state.tabId) return;
  const urlChanged = changeInfo.url && changeInfo.url !== state.pageInfo?.url;
  const completed = changeInfo.status === 'complete';

  if (!urlChanged && !completed) {
    // 仅 title 等变化：同步 toolbar
    if (tab && tab.title && tab.title !== state.pageInfo?.title) {
      state.pageInfo = { ...state.pageInfo, title: tab.title };
      updatePageInfo();
    }
    return;
  }

  // 防抖 + 冷却：800ms 内重复触发的 complete 直接忽略，避免 SPA 轰炸
  clearTimeout(_tabUpdateTimer);
  _tabUpdateTimer = setTimeout(() => {
    const now = Date.now();
    if (state._lastRefreshAt && now - state._lastRefreshAt < 800) return;
    state._lastRefreshAt = now;
    refreshAfterUpdate(tab);
  }, 250);
}

async function handleWindowFocusChanged(windowId) {
  // 切到其它窗口（可能切换了活动 tab）
  if (!windowId || windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (state.windowId && windowId !== state.windowId) {
    // 该窗口可能没有 sidebar，忽略
    return;
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, windowId });
    if (tabs[0] && tabs[0].id !== state.tabId) {
      switchToTab(tabs[0].id);
    }
  } catch (_) {}
}

/**
 * 切换到新 tab：取消进行中的请求、重载页面内容与翻译状态、给出提示
 */
async function switchToTab(tabId) {
  // 取消进行中的 AI 请求
  if (state.abortController) {
    try { state.abortController.abort(); } catch (_) {}
  }

  state.tabId = tabId;

  try {
    const tab = await chrome.tabs.get(tabId);
    state.pageInfo = { title: tab.title, url: tab.url };
    state.windowId = tab.windowId;
    updatePageInfo();
  } catch (_) {}

  // 重新加载页面内容
  state.pageContent = null;
  await loadPageContent();

  // 翻译按钮状态重置后再异步同步该 tab 的真实状态
  state.translateEnabled = false;
  updateTranslateBtn();
  syncTranslateStatus();

  // 顶部状态徽标提示（不打扰对话）
  showPageStatus('已切换页面', 1800);
}

/**
 * 同 tab 内页面更新（导航/刷新完成）：重新提取内容；如刷新前已开翻译，自动恢复
 */
async function refreshAfterUpdate(tab) {
  if (!tab) return;
  state.pageInfo = { title: tab.title, url: tab.url };
  updatePageInfo();

  state.pageContent = null;
  await loadPageContent();

  // 页面刷新会让 content script 重新加载，Translation 状态被重置。
  // 如果刷新前 sidebar 已是开启状态，则自动重新开启，保持视觉与功能一致。
  const wasEnabled = state.translateEnabled;
  if (wasEnabled) {
    state.translateEnabled = false;
    updateTranslateBtn();
    const target = getEffectiveLanguage();
    const resp = await sendToContent({ type: 'TLDR_TOGGLE_TRANSLATE', enable: true, target });
    if (resp && resp.enabled) {
      state.translateEnabled = true;
      updateTranslateBtn();
      showPageStatus('页面已更新 · 翻译已恢复', 1800);
      return;
    }
    // 如果 content 端没成功（如受限页面），也要把按钮置为关闭以反映真实状态
    state.translateEnabled = false;
    updateTranslateBtn();
    showPageStatus('页面已更新', 1500);
    return;
  }

  // 不在翻译态，仍以 content 真实状态为准
  syncTranslateStatus();
  showPageStatus('页面已更新', 1500);
}

/**
 * 在对话流中插入一条系统提示（保留给真正需要的场景，比如错误或一次性事件）
 */
function addSystemNotice(text) {
  const messagesEl = $('chatMessages');
  if (!messagesEl) return;
  const el = document.createElement('div');
  el.className = 'system-notice';
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * 顶部状态徽标：临时显示，自动消失
 */
let _pageStatusTimer = null;
function showPageStatus(text, duration = 1500) {
  const el = $('pageStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden', 'fade-out');
  clearTimeout(_pageStatusTimer);
  _pageStatusTimer = setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.classList.add('hidden'), 400);
  }, duration);
}

// ===== 页面信息更新 =====
function updatePageInfo() {
  if (state.pageInfo) {
    $('pageTitle').textContent = state.pageInfo.title || state.pageInfo.url || '未知页面';
    $('pageTitle').title = state.pageInfo.url || '';
  }
}

// ===== 加载页面内容 =====
async function loadPageContent() {
  updateContextStatus('loading', '正在提取页面内容...');

  try {
    if (!state.tabId) throw new Error('无法获取当前标签页');

    const result = await sendMessage({
      type: 'GET_PAGE_CONTENT',
      payload: { tabId: state.tabId }
    });

    if (result && result.content) {
      state.pageContent = result;
      updateContextStatus('loaded', `已加载 ${result.wordCount || 0} 字`);
    } else {
      updateContextStatus('error', '内容提取失败');
    }
  } catch (err) {
    console.error('[TLDR Sidebar] 加载内容失败:', err);
    updateContextStatus('error', '无法提取页面内容');
  }
}

// ===== 更新上下文状态 =====
function updateContextStatus(status, text) {
  const dot = document.querySelector('.context-dot');
  const statusEl = $('contextStatus');

  dot.className = `context-dot ${status}`;
  statusEl.textContent = text;
}

// ===== 是否已配置 API Key =====
function hasApiKey() {
  const s = state.settings || {};
  return !!(s.openaiApiKey || s.claudeApiKey || s.geminiApiKey || s.customApiKey);
}

// ===== 语言相关 =====
/**
 * 解析有效语言代码（BCP 47）：
 *  - 设置为 'auto' 或空 → 读取浏览器语言
 *  - 否则使用用户在设置中选择的语言
 */
function getEffectiveLanguage() {
  const lang = state.settings?.language;
  if (!lang || lang === 'auto') {
    try {
      const ui = (chrome.i18n && typeof chrome.i18n.getUILanguage === 'function')
        ? chrome.i18n.getUILanguage()
        : null;
      return ui || navigator.language || 'en';
    } catch (_) {
      return navigator.language || 'en';
    }
  }
  return lang;
}

/**
 * 获取语言代码对应的人类可读名称
 * @param {string} code BCP 47 语言代码，如 zh-CN / en / ja
 * @param {string} [displayLocale] 用哪种语言显示名字（默认与 code 同语种）
 */
function getLanguageDisplayName(code, displayLocale) {
  if (!code) return '';
  try {
    const dn = new Intl.DisplayNames([displayLocale || code], { type: 'language' });
    return dn.of(code) || code;
  } catch (_) {
    return code;
  }
}

// ===== 事件绑定 =====
function bindEvents() {
  // 标签页切换
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 摘要按钮（已合并到对话流） / 翻译按钮（已合并到快速操作）
  $('refreshBtn').addEventListener('click', refreshContent);

  // 快速操作（摘要类型 / 翻译 / 提问）
  $$('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'summary') {
        generateSummary({ auto: false, type: btn.dataset.type || 'brief' });
      } else if (action === 'translate') {
        toggleTranslate();
      } else if (btn.dataset.prompt) {
        $('chatInput').value = btn.dataset.prompt;
        updateCharCount();
        sendChatMessage();
      }
    });
  });

  // 对话相关
  $('chatInput').addEventListener('input', updateCharCount);
  $('chatInput').addEventListener('keydown', handleChatKeydown);
  $('sendBtn').addEventListener('click', sendChatMessage);
  $('clearChatBtn').addEventListener('click', clearChat);
  $('exportChatBtn').addEventListener('click', exportChat);
  $('newContextBtn').addEventListener('click', refreshContent);

  // 笔记相关
  $('addNoteBtn').addEventListener('click', addManualNote);
  $('exportNotesBtn').addEventListener('click', exportNotes);

  // 设置按钮
  $('settingsBtn').addEventListener('click', openSettings);

  // 监听来自background的消息
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
}

// ===== 标签页切换 =====
function switchTab(tabName) {
  state.currentTab = tabName;

  $$('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  $$('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `${tabName}Panel`);
  });
}

// ===== 生成摘要（合并到对话流） =====
async function generateSummary({ auto = false, type, lang } = {}) {
  // 已有任务在跑则忽略
  if (state.isLoading) {
    showToast('已有任务进行中，可点击"取消"后重试');
    return;
  }
  if (!state.pageContent) {
    if (!auto) showToast('请等待页面内容加载完成');
    return;
  }

  if (!hasApiKey()) {
    if (!auto) {
      showToast('请先在设置中配置AI API Key');
      openSettings();
    }
    return;
  }

  const summaryType = type || 'brief';
  const summaryLang = lang || getEffectiveLanguage();

  const typeLabels = {
    brief: '简短摘要',
    detailed: '详细摘要',
    bullets: '要点列表',
    outline: '文章大纲'
  };
  const langName = getLanguageDisplayName(summaryLang, summaryLang);
  const langNameEn = getLanguageDisplayName(summaryLang, 'en') || summaryLang;
  const userVisibleText = `请为当前页面生成${typeLabels[summaryType] || '摘要'}（${langName}）。`;

  const typePrompts = {
    brief: '请用3-5句话简洁总结这篇文章的核心内容',
    detailed: '请详细总结这篇文章，包括主要观点、论据和结论',
    bullets: '请用要点列表的形式总结这篇文章的主要内容（5-10个要点）',
    outline: '请为这篇文章生成一个结构化的大纲'
  };
  const langInstruction = `Please respond in ${langNameEn} (BCP 47: ${summaryLang}).`;
  const summaryUserPrompt = `${typePrompts[summaryType] || typePrompts.brief}。${langInstruction}`;

  // 切到对话页便于用户查看
  if (state.currentTab !== 'chat') switchTab('chat');
  hideWelcome();

  // 把"生成摘要"动作显示为用户消息
  addChatMessage('user', userVisibleText);
  state.chatHistory.push({ role: 'user', content: summaryUserPrompt });

  await runAIRequest({
    onError: (msg) => addChatMessage('assistant', `❌ 生成失败：${msg}`, true)
  });
}

// ===== 对话功能 =====
function updateCharCount() {
  const len = $('chatInput').value.length;
  $('charCount').textContent = `${len}/2000`;
  $('sendBtn').disabled = len === 0 || state.isLoading;
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendChatMessage();
  }
}

async function sendChatMessage() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text || state.isLoading) return;

  if (!hasApiKey()) {
    showToast('请先在设置中配置AI API Key');
    openSettings();
    return;
  }

  // 清空输入框
  input.value = '';
  updateCharCount();

  hideWelcome();

  // 添加用户消息
  addChatMessage('user', text);
  state.chatHistory.push({ role: 'user', content: text });

  await runAIRequest({
    onError: (msg) => addChatMessage('assistant', `❌ 出错了：${msg}`, true)
  });
}

/**
 * 统一的 AI 请求执行：构造消息、显示可取消的打字动画、调用 API、写回历史
 */
async function runAIRequest({ onError } = {}) {
  // 构建发送给 AI 的消息（system + 最近历史）
  const systemPrompt = buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...state.chatHistory.slice(-12)
  ];

  // 创建可取消的打字动画
  const controller = new AbortController();
  state.abortController = controller;
  state.isLoading = true;
  $('sendBtn').disabled = true;
  setQuickActionsDisabled(true);

  const typingEl = addTypingIndicator(() => {
    try { controller.abort(); } catch (_) {}
  });

  try {
    const result = await callAIWithAbort(messages, state.settings, controller.signal);
    typingEl.remove();
    addChatMessage('assistant', result.content);
    state.chatHistory.push({ role: 'assistant', content: result.content });
  } catch (err) {
    typingEl.remove();
    if (err.name === 'AbortError' || controller.signal.aborted) {
      // 用户主动取消
      addChatMessage('assistant', '⏹ 已取消本次生成', true);
    } else {
      console.error('[TLDR] AI 请求失败:', err);
      if (onError) onError(err.message || '未知错误');
      else addChatMessage('assistant', `❌ 出错了：${err.message}`, true);
    }
  } finally {
    state.isLoading = false;
    state.abortController = null;
    setQuickActionsDisabled(false);
    updateCharCount();
    $('chatInput').focus();
  }
}

/**
 * 构建系统提示词（包含页面上下文）
 */
function buildSystemPrompt() {
  const effLang = getEffectiveLanguage();
  const langNameEn = getLanguageDisplayName(effLang, 'en') || effLang;
  let prompt = `You are TLDR, an AI reading assistant that helps the user understand and analyze the current page. By default, reply in ${langNameEn} (BCP 47: ${effLang}) unless the user explicitly asks for another language.`;

  if (state.pageContent) {
    prompt += `\n\n当前页面信息：
- 标题：${state.pageContent.title}
- URL：${state.pageContent.url}
- 类型：${state.pageContent.type || 'webpage'}
- 字数：约${state.pageContent.wordCount || 0}字

页面内容（前8000字）：
${state.pageContent.content.substring(0, 8000)}

请基于以上内容回答用户的问题。如果问题超出页面内容范围，请说明并尽力提供帮助。`;
  } else {
    prompt += '\n\n注意：当前页面内容未能成功提取，请根据用户描述提供帮助。';
  }

  return prompt;
}

/**
 * 隐藏欢迎语（首次产生消息后）
 */
function hideWelcome() {
  const w = $('welcomeMsg');
  if (w) w.classList.add('hidden');
}

/**
 * 添加聊天消息到界面
 */
function addChatMessage(role, content, isError = false) {
  const messagesEl = $('chatMessages');
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const avatar = role === 'user' ? '👤' : '🤖';
  const bubbleContent = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);

  // 助手消息附带操作按钮
  const actionsHtml = role === 'assistant' && !isError ? `
    <div class="message-actions">
      <button class="mini-btn msg-copy-btn" title="复制">📋</button>
      <button class="mini-btn msg-save-btn" title="保存到笔记">📌</button>
    </div>` : '';

  msgEl.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="message-bubble ${isError ? 'error' : ''}">${bubbleContent}</div>
      <div class="message-meta">
        <span class="message-time">${time}</span>
        ${actionsHtml}
      </div>
    </div>
  `;

  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  if (role === 'assistant' && !isError) {
    const copyBtn = msgEl.querySelector('.msg-copy-btn');
    const saveBtn = msgEl.querySelector('.msg-save-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => showToast('已复制'));
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        addNote(content, 'AI回复');
        showToast('已保存到笔记');
      });
    }
  }

  return msgEl;
}

/**
 * 添加可取消的打字动画
 */
function addTypingIndicator(onCancel) {
  const messagesEl = $('chatMessages');
  const el = document.createElement('div');
  el.className = 'message assistant typing-message';
  el.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="typing-row">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
        <button class="cancel-btn" title="取消生成">取消</button>
      </div>
    </div>
  `;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  if (typeof onCancel === 'function') {
    el.querySelector('.cancel-btn').addEventListener('click', onCancel);
  }
  return el;
}

/**
 * 清空对话
 */
function clearChat() {
  // 取消进行中的请求
  if (state.abortController) {
    try { state.abortController.abort(); } catch (_) {}
  }
  state.chatHistory = [];
  const messagesEl = $('chatMessages');
  messagesEl.innerHTML = `
    <div class="welcome-msg" id="welcomeMsg">
      <div class="welcome-icon">🤖</div>
      <div class="welcome-text">
        <strong>对话已清空</strong>
        <p>你可以继续提问，或点击"生成摘要"重新总结当前页面。</p>
      </div>
    </div>
  `;
  showToast('对话已清空');
}

/**
 * 导出对话
 */
function exportChat() {
  if (state.chatHistory.length === 0) {
    showToast('没有可导出的对话');
    return;
  }

  const content = state.chatHistory.map(msg => {
    const role = msg.role === 'user' ? '用户' : 'AI助手';
    return `${role}：\n${msg.content}`;
  }).join('\n\n---\n\n');

  const header = `TLDR对话记录\n页面：${state.pageInfo?.title || ''}\nURL：${state.pageInfo?.url || ''}\n时间：${new Date().toLocaleString()}\n\n${'='.repeat(50)}\n\n`;

  downloadText(header + content, `TLDR对话_${Date.now()}.txt`);
  showToast('对话已导出');
}

// ===== 刷新内容 =====
async function refreshContent() {
  state.pageContent = null;
  await loadPageContent();
  showToast('页面内容已刷新');
}

// ===== 笔记功能 =====
function loadNotes() {
  chrome.storage.local.get('tldrNotes', (result) => {
    state.notes = result.tldrNotes || [];
    renderNotes();
  });
}

function saveNotes() {
  chrome.storage.local.set({ tldrNotes: state.notes });
}

function addNote(content, type = '手动') {
  const note = {
    id: Date.now(),
    content,
    type,
    source: state.pageInfo?.title || '',
    url: state.pageInfo?.url || '',
    time: new Date().toISOString()
  };
  state.notes.unshift(note);
  saveNotes();
  renderNotes();
}

function addManualNote() {
  const content = prompt('输入笔记内容：');
  if (content?.trim()) {
    addNote(content.trim(), '手动');
    showToast('笔记已添加');
  }
}

function deleteNote(id) {
  state.notes = state.notes.filter(n => n.id !== id);
  saveNotes();
  renderNotes();
}

function renderNotes() {
  const listEl = $('notesList');

  if (state.notes.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📌</div>
        <p>还没有笔记，从对话中保存内容，或点击"新建笔记"</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = state.notes.map(note => `
    <div class="note-item" data-id="${note.id}">
      <div class="note-item-header">
        <span class="note-source" title="${escapeHtml(note.url)}">${escapeHtml(note.source) || '未知来源'}</span>
        <span class="note-time">${formatTime(note.time)}</span>
      </div>
      <div class="note-text">${escapeHtml(note.content).substring(0, 300)}${note.content.length > 300 ? '...' : ''}</div>
      <div class="note-actions">
        <button class="mini-btn copy-note-btn" data-id="${note.id}" title="复制">📋</button>
        <button class="mini-btn delete-note-btn" data-id="${note.id}" title="删除">🗑️</button>
      </div>
    </div>
  `).join('');

  // 绑定笔记操作事件
  listEl.querySelectorAll('.copy-note-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const note = state.notes.find(n => n.id === parseInt(btn.dataset.id));
      if (note) {
        navigator.clipboard.writeText(note.content).then(() => showToast('已复制'));
      }
    });
  });

  listEl.querySelectorAll('.delete-note-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('确定删除这条笔记？')) {
        deleteNote(parseInt(btn.dataset.id));
      }
    });
  });
}

function exportNotes() {
  if (state.notes.length === 0) {
    showToast('没有可导出的笔记');
    return;
  }

  const content = state.notes.map(note => {
    return `[${note.type}] ${note.source}\n${note.url}\n${formatTime(note.time)}\n\n${note.content}`;
  }).join('\n\n' + '='.repeat(50) + '\n\n');

  downloadText(content, `TLDR笔记_${Date.now()}.txt`);
  showToast('笔记已导出');
}

// ===== 设置 =====
function openSettings() {
  chrome.runtime.openOptionsPage();
}

// ===== 沉浸式翻译 =====
async function toggleTranslate() {
  if (!state.tabId) {
    showToast('未获取到当前标签页');
    return;
  }
  if (!state.translateEnabled && !hasApiKey()) {
    showToast('请先在设置中配置AI API Key');
    openSettings();
    return;
  }

  // 默认目标语言：跟随设置（auto 时取浏览器语言）
  const target = getEffectiveLanguage();
  const enable = !state.translateEnabled;

  try {
    const resp = await sendToContent({ type: 'TLDR_TOGGLE_TRANSLATE', enable, target });
    if (!resp || resp.error) {
      throw new Error(resp?.error || '与页面通信失败，可能是受限页面');
    }
    state.translateEnabled = !!resp.enabled;
    updateTranslateBtn();
    showToast(state.translateEnabled ? '已开启双语翻译' : '已关闭双语翻译');
  } catch (err) {
    console.error('[TLDR] 翻译开关失败:', err);
    showToast(`翻译启用失败：${err.message}`);
  }
}

function updateTranslateBtn() {
  const btn = $('translateQuickBtn');
  const text = $('translateBtnText');
  if (!btn) return;
  // 文案保持不变（"🌐 双语翻译"），开/关仅用 active 高亮区分
  if (text) text.textContent = '🌐 双语翻译';
  if (state.translateEnabled) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

async function syncTranslateStatus() {
  const resp = await sendToContent({ type: 'TLDR_TRANSLATE_STATUS' });
  if (resp && typeof resp.enabled === 'boolean') {
    state.translateEnabled = resp.enabled;
    updateTranslateBtn();
  }
}

/**
 * 在 AI 请求期间禁用快速操作按钮（避免重复触发）
 */
function setQuickActionsDisabled(disabled) {
  $$('.quick-btn[data-action]').forEach(btn => {
    // 翻译按钮始终可用（用于取消/切换状态），其他禁用
    if (btn.dataset.action === 'translate') return;
    btn.disabled = !!disabled;
  });
}

/**
 * 向当前标签页的 content script 发送消息；
 * 若未注入（"Receiving end does not exist"），自动按需注入后重试一次。
 */
function sendToContent(message) {
  return new Promise(async (resolve) => {
    if (!state.tabId) return resolve({ error: '无效的标签页' });

    const trySend = () => new Promise((res) => {
      try {
        chrome.tabs.sendMessage(state.tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            res({ error: chrome.runtime.lastError.message });
          } else {
            res(response || {});
          }
        });
      } catch (err) {
        res({ error: err.message });
      }
    });

    let result = await trySend();
    const needsInject = result && result.error &&
      /Receiving end does not exist|Could not establish connection/i.test(result.error);

    if (needsInject) {
      const injected = await injectContentScript(state.tabId);
      if (injected) {
        // 留出极短时间让 content script 注册 onMessage
        await new Promise(r => setTimeout(r, 30));
        result = await trySend();
      } else {
        result = { error: '当前页面不允许注入脚本（如 chrome://、应用商店或 PDF 内置查看器等）' };
      }
    }
    resolve(result);
  });
}

/**
 * 主动把 content script 注入到指定标签页（仅在受限页面会失败）
 */
function injectContentScript(tabId) {
  return new Promise((resolve) => {
    if (!chrome.scripting?.executeScript) return resolve(false);
    try {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content.js']
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[TLDR] 注入 content script 失败:', chrome.runtime.lastError.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (err) {
      console.warn('[TLDR] 注入 content script 异常:', err);
      resolve(false);
    }
  });
}

// ===== 处理来自background的消息 =====
function handleBackgroundMessage(message) {
  if (message.type === 'SELECTION_TO_SUMMARIZE') {
    switchTab('chat');
    setTimeout(() => {
      $('chatInput').value = `请总结以下内容：\n\n${message.text}`;
      updateCharCount();
    }, 100);
  }
}

// ===== 检查待处理的选中文本 =====
async function checkPendingSelection() {
  try {
    const result = await chrome.storage.session.get('pendingSelection').catch(() => ({}));
    if (result.pendingSelection) {
      await chrome.storage.session.remove('pendingSelection');
      switchTab('chat');
      $('chatInput').value = `请总结以下内容：\n\n${result.pendingSelection}`;
      updateCharCount();
      return true;
    }
  } catch (_) {}
  return false;
}

// ===== AI 调用（在侧边栏直接发起，支持 AbortController 取消） =====
async function callAIWithAbort(messages, settings, signal) {
  const provider = settings.aiProvider || 'openai';
  switch (provider) {
    case 'openai':
    case 'custom':
      return await callOpenAICompatible(messages, settings, signal);
    case 'claude':
      return await callClaude(messages, settings, signal);
    case 'gemini':
      return await callGemini(messages, settings, signal);
    default:
      throw new Error(`不支持的AI提供商: ${provider}`);
  }
}

async function callOpenAICompatible(messages, settings, signal) {
  const isCustom = settings.aiProvider === 'custom';
  const apiKey = isCustom ? settings.customApiKey : settings.openaiApiKey;
  const model = isCustom ? settings.customModel : (settings.openaiModel || 'gpt-4o-mini');
  const baseUrl = isCustom
    ? (settings.customBaseUrl || 'https://api.openai.com/v1')
    : (settings.openaiBaseUrl || 'https://api.openai.com/v1');

  if (!apiKey) throw new Error('请先配置API Key');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: settings.maxTokens || 2000,
      temperature: settings.temperature || 0.7
    }),
    signal
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API请求失败: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0]?.message?.content || '',
    usage: data.usage
  };
}

async function callClaude(messages, settings, signal) {
  const apiKey = settings.claudeApiKey;
  const model = settings.claudeModel || 'claude-3-5-haiku-20241022';
  if (!apiKey) throw new Error('请先配置Claude API Key');

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const body = {
    model,
    max_tokens: settings.maxTokens || 2000,
    messages: chatMessages
  };
  if (systemMsg) body.system = systemMsg.content;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Claude API请求失败: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.content[0]?.text || '',
    usage: data.usage
  };
}

async function callGemini(messages, settings, signal) {
  const apiKey = settings.geminiApiKey;
  const model = settings.geminiModel || 'gemini-1.5-flash';
  if (!apiKey) throw new Error('请先配置Gemini API Key');

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = { contents };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  body.generationConfig = {
    maxOutputTokens: settings.maxTokens || 2000,
    temperature: settings.temperature || 0.7
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Gemini API请求失败: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.candidates[0]?.content?.parts[0]?.text || '',
    usage: data.usageMetadata
  };
}

// ===== 工具函数 =====

/**
 * 发送消息到background
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * 简单Markdown渲染
 */
function renderMarkdown(text) {
  if (!text) return '';

  // 先转义 HTML，防止 XSS
  const escaped = escapeHtml(text);

  return escaped
    // 代码块
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // 行内代码
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 标题
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 无序列表
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // 有序列表
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // 分割线
    .replace(/^---$/gm, '<hr>')
    // 段落
    .replace(/\n\n/g, '</p><p>');
}

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

/**
 * 格式化时间
 */
function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return date.toLocaleDateString('zh-CN');
}

/**
 * 下载文本文件
 */
function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 显示Toast提示
 */
function showToast(message, duration = 2500) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
