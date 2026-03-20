/**
 * TLDR Chrome插件 - Background Service Worker
 * 负责：消息路由、AI API调用、上下文管理
 */

// 插件安装/更新时初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[TLDR] 插件已安装/更新', details.reason);
  
  // 初始化默认设置
  const defaultSettings = {
    aiProvider: 'openai',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    openaiBaseUrl: 'https://api.openai.com/v1',
    claudeApiKey: '',
    claudeModel: 'claude-3-5-haiku-20241022',
    geminiApiKey: '',
    geminiModel: 'gemini-1.5-flash',
    customApiKey: '',
    customModel: '',
    customBaseUrl: '',
    language: 'zh',
    autoSummarize: false,
    maxTokens: 2000,
    temperature: 0.7
  };
  
  const existing = await chrome.storage.sync.get(Object.keys(defaultSettings));
  const toSet = {};
  for (const [key, value] of Object.entries(defaultSettings)) {
    if (existing[key] === undefined) {
      toSet[key] = value;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.sync.set(toSet);
  }
  
  // 设置右键菜单
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'tldr-summarize',
      title: '用TLDR总结选中内容',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'tldr-open-sidebar',
      title: '打开TLDR阅读助手',
      contexts: ['page', 'frame']
    });
  });
});

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'tldr-summarize' && info.selectionText) {
    await chrome.sidePanel.open({ tabId: tab.id });
    // 延迟发送消息，等待侧边栏加载
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SUMMARIZE_SELECTION',
        text: info.selectionText
      }).catch(() => {});
    }, 500);
  } else if (info.menuItemId === 'tldr-open-sidebar') {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// 插件图标点击 - 打开侧边栏
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// 消息处理中心
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('[TLDR Background] 消息处理错误:', err);
    sendResponse({ error: err.message || '处理失败' });
  });
  return true; // 保持消息通道开放
});

/**
 * 统一消息处理
 */
async function handleMessage(message, sender) {
  const { type, payload } = message;
  
  switch (type) {
    case 'GET_PAGE_CONTENT':
      return await getPageContent(sender.tab?.id || payload?.tabId);
      
    case 'AI_CHAT':
      return await callAI(payload.messages, payload.settings);
      
    case 'AI_STREAM_CHAT':
      return await callAIStream(payload.messages, payload.settings, sender.tab?.id);
      
    case 'GET_SETTINGS':
      return await getSettings();
      
    case 'SAVE_SETTINGS':
      return await saveSettings(payload);
      
    case 'GET_TAB_INFO':
      return await getTabInfo(sender.tab?.id || payload?.tabId);
      
    default:
      throw new Error(`未知消息类型: ${type}`);
  }
}

/**
 * 获取当前标签页内容
 */
async function getPageContent(tabId) {
  if (!tabId) throw new Error('无效的标签页ID');
  
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 在页面中执行，获取内容
        return window.__tldrExtractContent ? window.__tldrExtractContent() : null;
      }
    });
    
    if (results && results[0]?.result) {
      return results[0].result;
    }
    
    // 如果内容脚本未注入，尝试直接提取
    const extractResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageContentDirect
    });
    
    return extractResults[0]?.result || { title: '', content: '', url: '' };
  } catch (err) {
    console.error('[TLDR] 获取页面内容失败:', err);
    return { title: '', content: '', url: '', error: err.message };
  }
}

/**
 * 直接提取页面内容（注入函数）
 */
function extractPageContentDirect() {
  const title = document.title || '';
  const url = window.location.href;
  
  // 移除不需要的元素
  const removeSelectors = [
    'script', 'style', 'nav', 'header', 'footer', 
    '.advertisement', '.ads', '#cookie-banner',
    '[role="banner"]', '[role="navigation"]'
  ];
  
  const cloneDoc = document.cloneNode(true);
  removeSelectors.forEach(sel => {
    cloneDoc.querySelectorAll(sel).forEach(el => el.remove());
  });
  
  // 尝试获取主要内容
  const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.post-content'];
  let mainContent = null;
  for (const sel of mainSelectors) {
    const el = cloneDoc.querySelector(sel);
    if (el && el.textContent.trim().length > 200) {
      mainContent = el;
      break;
    }
  }
  
  const contentEl = mainContent || cloneDoc.body;
  const text = contentEl ? contentEl.innerText || contentEl.textContent : '';
  
  return {
    title,
    url,
    content: text.replace(/\s+/g, ' ').trim().substring(0, 50000),
    wordCount: text.split(/\s+/).length
  };
}

/**
 * 获取标签页信息
 */
async function getTabInfo(tabId) {
  if (!tabId) throw new Error('无效的标签页ID');
  const tab = await chrome.tabs.get(tabId);
  return { title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl };
}

/**
 * 获取设置
 */
async function getSettings() {
  return await chrome.storage.sync.get(null);
}

/**
 * 保存设置
 */
async function saveSettings(settings) {
  await chrome.storage.sync.set(settings);
  return { success: true };
}

/**
 * 调用AI API（非流式）
 */
async function callAI(messages, settings) {
  const provider = settings.aiProvider || 'openai';
  
  switch (provider) {
    case 'openai':
    case 'custom':
      return await callOpenAICompatible(messages, settings);
    case 'claude':
      return await callClaude(messages, settings);
    case 'gemini':
      return await callGemini(messages, settings);
    default:
      throw new Error(`不支持的AI提供商: ${provider}`);
  }
}

/**
 * 调用OpenAI兼容API
 */
async function callOpenAICompatible(messages, settings) {
  const isCustom = settings.aiProvider === 'custom';
  const apiKey = isCustom ? settings.customApiKey : settings.openaiApiKey;
  const model = isCustom ? settings.customModel : (settings.openaiModel || 'gpt-4o-mini');
  const baseUrl = isCustom ? (settings.customBaseUrl || 'https://api.openai.com/v1') : (settings.openaiBaseUrl || 'https://api.openai.com/v1');
  
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
    })
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

/**
 * 调用Claude API
 */
async function callClaude(messages, settings) {
  const apiKey = settings.claudeApiKey;
  const model = settings.claudeModel || 'claude-3-5-haiku-20241022';
  
  if (!apiKey) throw new Error('请先配置Claude API Key');
  
  // 分离system消息
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
    body: JSON.stringify(body)
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

/**
 * 调用Gemini API
 */
async function callGemini(messages, settings) {
  const apiKey = settings.geminiApiKey;
  const model = settings.geminiModel || 'gemini-1.5-flash';
  
  if (!apiKey) throw new Error('请先配置Gemini API Key');
  
  // 转换消息格式
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  
  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  
  const body = { contents };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }
  body.generationConfig = {
    maxOutputTokens: settings.maxTokens || 2000,
    temperature: settings.temperature || 0.7
  };
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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

console.log('[TLDR] Background Service Worker 已启动');
