/**
 * TLDR Chrome插件 - 设置页面逻辑
 */

// ===== 默认设置 =====
const DEFAULT_SETTINGS = {
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

// ===== DOM引用 =====
const $ = id => document.getElementById(id);

// ===== 初始化 =====
async function init() {
  await loadSettings();
  bindEvents();
}

// ===== 加载设置 =====
async function loadSettings() {
  const settings = await chrome.storage.sync.get(null);
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  
  // 填充表单
  $('openaiApiKey').value = merged.openaiApiKey || '';
  $('openaiModel').value = merged.openaiModel || 'gpt-4o-mini';
  $('openaiBaseUrl').value = merged.openaiBaseUrl || 'https://api.openai.com/v1';
  
  $('claudeApiKey').value = merged.claudeApiKey || '';
  $('claudeModel').value = merged.claudeModel || 'claude-3-5-haiku-20241022';
  
  $('geminiApiKey').value = merged.geminiApiKey || '';
  $('geminiModel').value = merged.geminiModel || 'gemini-1.5-flash';
  
  $('customApiKey').value = merged.customApiKey || '';
  $('customModel').value = merged.customModel || '';
  $('customBaseUrl').value = merged.customBaseUrl || '';
  
  $('language').value = merged.language || 'zh';
  $('maxTokens').value = merged.maxTokens || 2000;
  $('maxTokensValue').textContent = merged.maxTokens || 2000;
  $('temperature').value = merged.temperature || 0.7;
  $('temperatureValue').textContent = merged.temperature || 0.7;
  $('autoSummarize').checked = merged.autoSummarize || false;
  
  // 设置选中的提供商
  selectProvider(merged.aiProvider || 'openai');
}

// ===== 选择提供商 =====
function selectProvider(provider) {
  // 更新radio
  const radio = document.querySelector(`input[name="aiProvider"][value="${provider}"]`);
  if (radio) radio.checked = true;
  
  // 更新卡片样式
  document.querySelectorAll('.provider-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.provider === provider);
  });
  
  // 显示对应配置
  document.querySelectorAll('.provider-config').forEach(config => {
    config.classList.add('hidden');
  });
  
  const configMap = {
    openai: 'openaiConfig',
    claude: 'claudeConfig',
    gemini: 'geminiConfig',
    custom: 'customConfig'
  };
  
  const configId = configMap[provider];
  if (configId) {
    $(configId).classList.remove('hidden');
  }
}

// ===== 绑定事件 =====
function bindEvents() {
  // 提供商选择
  document.querySelectorAll('.provider-card').forEach(card => {
    card.addEventListener('click', () => {
      selectProvider(card.dataset.provider);
    });
  });
  
  // 密码可见性切换
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? '👁' : '🙈';
      }
    });
  });
  
  // 范围滑块
  $('maxTokens').addEventListener('input', (e) => {
    $('maxTokensValue').textContent = e.target.value;
  });
  
  $('temperature').addEventListener('input', (e) => {
    $('temperatureValue').textContent = parseFloat(e.target.value).toFixed(1);
  });
  
  // 保存按钮
  $('saveBtn').addEventListener('click', saveSettings);
  
  // 重置按钮
  $('resetBtn').addEventListener('click', resetSettings);
  
  // 测试连接
  $('testBtn').addEventListener('click', testConnection);
  
  // 数据管理
  $('exportDataBtn').addEventListener('click', exportData);
  $('clearDataBtn').addEventListener('click', clearData);
  
  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveSettings();
    }
  });
}

// ===== 获取当前设置 =====
function getCurrentSettings() {
  const provider = document.querySelector('input[name="aiProvider"]:checked')?.value || 'openai';
  
  return {
    aiProvider: provider,
    openaiApiKey: $('openaiApiKey').value.trim(),
    openaiModel: $('openaiModel').value,
    openaiBaseUrl: $('openaiBaseUrl').value.trim() || 'https://api.openai.com/v1',
    claudeApiKey: $('claudeApiKey').value.trim(),
    claudeModel: $('claudeModel').value,
    geminiApiKey: $('geminiApiKey').value.trim(),
    geminiModel: $('geminiModel').value,
    customApiKey: $('customApiKey').value.trim(),
    customModel: $('customModel').value.trim(),
    customBaseUrl: $('customBaseUrl').value.trim(),
    language: $('language').value,
    maxTokens: parseInt($('maxTokens').value),
    temperature: parseFloat($('temperature').value),
    autoSummarize: $('autoSummarize').checked
  };
}

// ===== 保存设置 =====
async function saveSettings() {
  const settings = getCurrentSettings();
  
  // 验证必填项
  const provider = settings.aiProvider;
  const validations = {
    openai: () => settings.openaiApiKey,
    claude: () => settings.claudeApiKey,
    gemini: () => settings.geminiApiKey,
    custom: () => settings.customApiKey && settings.customModel && settings.customBaseUrl
  };
  
  if (validations[provider] && !validations[provider]()) {
    showToast('请填写必要的API配置信息', 'error');
    return;
  }
  
  try {
    await chrome.storage.sync.set(settings);
    showToast('✅ 设置已保存');
  } catch (err) {
    showToast(`保存失败: ${err.message}`, 'error');
  }
}

// ===== 重置设置 =====
async function resetSettings() {
  if (!confirm('确定要重置所有设置为默认值吗？这将清除所有API Key配置。')) return;
  
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await loadSettings();
  showToast('✅ 已重置为默认设置');
}

// ===== 测试连接 =====
async function testConnection() {
  const settings = getCurrentSettings();
  const testBtn = $('testBtn');
  const testResult = $('testResult');
  
  testBtn.disabled = true;
  testBtn.textContent = '测试中...';
  testResult.className = 'test-result hidden';
  
  try {
    // 先保存当前设置
    await chrome.storage.sync.set(settings);
    
    // 发送测试消息
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'AI_CHAT',
        payload: {
          messages: [
            { role: 'user', content: '请回复"连接成功"这四个字，不要说其他内容。' }
          ],
          settings
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
    
    testResult.className = 'test-result success';
    testResult.textContent = `✅ 连接成功！AI回复：${result.content}`;
    
  } catch (err) {
    testResult.className = 'test-result error';
    testResult.textContent = `❌ 连接失败：${err.message}`;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '测试AI连接';
    testResult.classList.remove('hidden');
  }
}

// ===== 导出数据 =====
async function exportData() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get(null)
  ]);
  
  // 隐藏API Key
  const exportSettings = { ...syncData };
  ['openaiApiKey', 'claudeApiKey', 'geminiApiKey', 'customApiKey'].forEach(key => {
    if (exportSettings[key]) exportSettings[key] = '***已隐藏***';
  });
  
  const exportData = {
    version: '1.0.0',
    exportTime: new Date().toISOString(),
    settings: exportSettings,
    notes: localData.tldrNotes || []
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TLDR数据备份_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('✅ 数据已导出');
}

// ===== 清除数据 =====
async function clearData() {
  if (!confirm('确定要清除所有数据吗？这将删除所有笔记和设置（API Key也会被清除）。此操作不可撤销！')) return;
  
  await Promise.all([
    chrome.storage.sync.clear(),
    chrome.storage.local.clear()
  ]);
  
  // 重新初始化默认设置
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await loadSettings();
  
  showToast('✅ 所有数据已清除');
}

// ===== 显示提示 =====
function showToast(message, type = 'success') {
  const toast = $('saveToast');
  toast.textContent = message;
  toast.className = `save-toast ${type === 'error' ? 'error' : ''}`;
  toast.classList.remove('hidden');
  
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
