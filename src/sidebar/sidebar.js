/**
 * TLDR Chrome插件 - 侧边栏主逻辑
 * 功能：摘要生成、AI对话、笔记管理
 */

// ===== 状态管理 =====
const state = {
  currentTab: 'summary',
  pageContent: null,
  pageInfo: null,
  chatHistory: [],
  notes: [],
  isLoading: false,
  settings: null,
  tabId: null
};

// ===== DOM元素引用 =====
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ===== 初始化 =====
async function init() {
  // 加载设置
  state.settings = await sendMessage({ type: 'GET_SETTINGS' });
  
  // 获取当前标签页信息
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    state.tabId = tabs[0].id;
    state.pageInfo = { title: tabs[0].title, url: tabs[0].url };
    updatePageInfo();
  }
  
  // 加载笔记
  loadNotes();
  
  // 绑定事件
  bindEvents();
  
  // 加载页面内容
  await loadPageContent();
  
  // 检查是否有待处理的选中文本
  checkPendingSelection();
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

// ===== 事件绑定 =====
function bindEvents() {
  // 标签页切换
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  
  // 摘要相关
  $('summarizeBtn').addEventListener('click', generateSummary);
  $('copySummaryBtn').addEventListener('click', copySummary);
  $('saveSummaryBtn').addEventListener('click', saveSummaryToNotes);
  $('refreshBtn').addEventListener('click', refreshContent);
  
  // 快速问题
  $$('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      switchTab('chat');
      setTimeout(() => {
        $('chatInput').value = prompt;
        updateCharCount();
        sendChatMessage();
      }, 100);
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

// ===== 生成摘要 =====
async function generateSummary() {
  if (!state.pageContent) {
    showToast('请等待页面内容加载完成');
    return;
  }
  
  if (!state.settings?.openaiApiKey && !state.settings?.claudeApiKey && 
      !state.settings?.geminiApiKey && !state.settings?.customApiKey) {
    showToast('请先在设置中配置AI API Key');
    openSettings();
    return;
  }
  
  const summaryType = $('summaryType').value;
  const summaryLang = $('summaryLang').value;
  
  const typePrompts = {
    brief: '请用3-5句话简洁总结这篇文章的核心内容',
    detailed: '请详细总结这篇文章，包括主要观点、论据和结论',
    bullets: '请用要点列表的形式总结这篇文章的主要内容（5-10个要点）',
    outline: '请为这篇文章生成一个结构化的大纲'
  };
  
  const langInstruction = summaryLang === 'zh' ? '请用中文回答。' : 'Please respond in English.';
  
  const systemPrompt = `你是一个专业的文章摘要助手。${langInstruction}
当前页面信息：
- 标题：${state.pageContent.title}
- URL：${state.pageContent.url}
- 类型：${state.pageContent.type || 'webpage'}`;

  const userPrompt = `${typePrompts[summaryType]}。

文章内容：
${state.pageContent.content.substring(0, 8000)}`;

  showLoading('AI正在生成摘要...');
  $('summarizeBtn').disabled = true;
  
  try {
    const result = await sendMessage({
      type: 'AI_CHAT',
      payload: {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        settings: state.settings
      }
    });
    
    if (result.error) throw new Error(result.error);
    
    // 显示摘要结果
    $('summaryEmpty').classList.add('hidden');
    $('summaryResult').classList.remove('hidden');
    $('summaryText').innerHTML = renderMarkdown(result.content);
    
    // 保存到状态
    state.lastSummary = result.content;
    
  } catch (err) {
    showToast(`生成失败: ${err.message}`);
    console.error('[TLDR] 摘要生成失败:', err);
  } finally {
    hideLoading();
    $('summarizeBtn').disabled = false;
  }
}

// ===== 复制摘要 =====
function copySummary() {
  if (state.lastSummary) {
    navigator.clipboard.writeText(state.lastSummary).then(() => {
      showToast('已复制到剪贴板');
    });
  }
}

// ===== 保存摘要到笔记 =====
function saveSummaryToNotes() {
  if (state.lastSummary) {
    addNote(state.lastSummary, '摘要');
    showToast('已保存到笔记');
    switchTab('notes');
  }
}

// ===== 刷新内容 =====
async function refreshContent() {
  state.pageContent = null;
  await loadPageContent();
  showToast('页面内容已刷新');
}

// ===== 对话功能 =====
function updateCharCount() {
  const len = $('chatInput').value.length;
  $('charCount').textContent = `${len}/2000`;
  $('sendBtn').disabled = len === 0;
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
  
  if (!state.settings?.openaiApiKey && !state.settings?.claudeApiKey && 
      !state.settings?.geminiApiKey && !state.settings?.customApiKey) {
    showToast('请先在设置中配置AI API Key');
    openSettings();
    return;
  }
  
  // 清空输入框
  input.value = '';
  updateCharCount();
  
  // 添加用户消息
  addChatMessage('user', text);
  
  // 构建消息历史
  const systemPrompt = buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...state.chatHistory.slice(-10), // 保留最近10条历史
    { role: 'user', content: text }
  ];
  
  // 添加到历史
  state.chatHistory.push({ role: 'user', content: text });
  
  // 显示打字动画
  const typingEl = addTypingIndicator();
  state.isLoading = true;
  $('sendBtn').disabled = true;
  
  try {
    const result = await sendMessage({
      type: 'AI_CHAT',
      payload: { messages, settings: state.settings }
    });
    
    if (result.error) throw new Error(result.error);
    
    // 移除打字动画，添加AI回复
    typingEl.remove();
    addChatMessage('assistant', result.content);
    
    // 添加到历史
    state.chatHistory.push({ role: 'assistant', content: result.content });
    
  } catch (err) {
    typingEl.remove();
    addChatMessage('assistant', `❌ 出错了：${err.message}`, true);
    console.error('[TLDR] 对话失败:', err);
  } finally {
    state.isLoading = false;
    $('sendBtn').disabled = false;
    input.focus();
  }
}

/**
 * 构建系统提示词（包含页面上下文）
 */
function buildSystemPrompt() {
  const lang = state.settings?.language === 'en' ? 'English' : '中文';
  let prompt = `你是TLDR AI阅读助手，帮助用户理解和分析当前页面内容。请用${lang}回答。`;
  
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
 * 添加聊天消息到界面
 */
function addChatMessage(role, content, isError = false) {
  const messagesEl = $('chatMessages');
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;
  
  const avatar = role === 'user' ? '👤' : '🤖';
  const bubbleContent = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);
  
  msgEl.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="message-bubble ${isError ? 'error' : ''}">${bubbleContent}</div>
      <div class="message-time">${time}</div>
    </div>
  `;
  
  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  
  return msgEl;
}

/**
 * 添加打字动画
 */
function addTypingIndicator() {
  const messagesEl = $('chatMessages');
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

/**
 * 清空对话
 */
function clearChat() {
  state.chatHistory = [];
  const messagesEl = $('chatMessages');
  messagesEl.innerHTML = `
    <div class="welcome-msg">
      <div class="welcome-icon">🤖</div>
      <div class="welcome-text">
        <strong>对话已清空</strong>
        <p>你可以继续提问关于当前页面的问题。</p>
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
        <p>还没有笔记，从摘要或对话中保存内容，或点击"新建笔记"</p>
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = state.notes.map(note => `
    <div class="note-item" data-id="${note.id}">
      <div class="note-item-header">
        <span class="note-source" title="${note.url}">${note.source || '未知来源'}</span>
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
  const result = await chrome.storage.session.get('pendingSelection').catch(() => ({}));
  if (result.pendingSelection) {
    await chrome.storage.session.remove('pendingSelection');
    switchTab('chat');
    $('chatInput').value = `请总结以下内容：\n\n${result.pendingSelection}`;
    updateCharCount();
  }
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
  
  return text
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
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('<')) return match;
      return match;
    });
}

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
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

/**
 * 显示加载遮罩
 */
function showLoading(text = 'AI思考中...') {
  $('loadingText').textContent = text;
  $('loadingOverlay').classList.remove('hidden');
}

/**
 * 隐藏加载遮罩
 */
function hideLoading() {
  $('loadingOverlay').classList.add('hidden');
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
