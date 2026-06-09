const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// ============ 配置区 ============
const CHROME_DEBUG_URL = 'http://localhost:9222';
const ZIP_PATH = path.join(__dirname, 'tldr-extension-v1.0.0.zip');
const SCREENSHOT_DIR = path.join(__dirname, 'publish-screenshots');
const EDGE_PARTNER_URL = 'https://partner.microsoft.com/dashboard/microsoftedge/';

// 扩展商店信息
const STORE_INFO = {
  name: 'TLDR - AI阅读助手',
  shortDescription: 'AI驱动的阅读助手，支持网页、PDF、Word文档摘要与智能对话，类似NotebookLM',
  detailedDescription: `TLDR - AI阅读助手 是一款强大的浏览器扩展，利用AI技术帮助你快速理解网页内容。

主要功能：
📖 智能摘要 — 一键生成网页、PDF、Word文档的精简摘要，快速把握核心内容
💬 上下文对话 — 基于当前页面内容进行智能问答，深入理解文档细节
🔧 多模型支持 — 支持 OpenAI、Anthropic Claude、Google Gemini 及自定义 API 地址
🌐 全场景覆盖 — 适用于新闻文章、技术文档、学术论文等各类网页内容
🔒 隐私优先 — API Key 本地存储，不上传任何用户数据

使用方法：
1. 点击扩展图标或右键菜单打开侧边栏
2. 在设置页面配置你的 AI API Key
3. 浏览任意网页，点击摘要按钮即可生成摘要
4. 在对话框中针对页面内容提问

适用于需要快速阅读大量网页内容的开发者、研究人员和学生。`,
  longDescription: `TLDR is a powerful browser extension that uses AI technology to help you quickly understand web content.

Key Features:
📖 Smart Summarization — Generate concise summaries of web pages, PDFs, and Word documents with one click
💬 Contextual Chat — Ask questions about the current page content with AI-powered answers
🔧 Multi-Model Support — Works with OpenAI, Anthropic Claude, Google Gemini, and custom API endpoints
🌐 Universal Coverage — Works on news articles, technical docs, academic papers, and more
🔒 Privacy First — API keys stored locally, no user data uploaded

How to use:
1. Click the extension icon or right-click menu to open the sidebar
2. Configure your AI API key in the settings page
3. Browse any webpage and click the summarize button
4. Ask questions about the page content in the chat

Perfect for developers, researchers, and students who need to quickly digest large amounts of web content.`,
  category: 'Productivity',
  subcategory: 'Communication',
  privacyPolicyUrl: 'https://github.com/dimayip/tldr-extension/blob/main/PRIVACY_POLICY.md',
  supportUrl: 'https://github.com/dimayip/tldr-extension/issues',
  websiteUrl: 'https://github.com/dimayip/tldr-extension',
};

// ============ 工具函数 ============
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `edge-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`📸 截图: ${filePath}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryClick(page, selectors, label) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        console.log(`✅ 点击了 ${label}`);
        return true;
      }
    } catch (e) {}
  }
  // Try by text
  try {
    const elements = await page.$$('button, a, [role="button"]');
    for (const el of elements) {
      const text = await page.evaluate(e => e.textContent.trim(), el);
      if (text && text.includes(label)) {
        await el.click();
        console.log(`✅ 通过文本点击了 "${text}"`);
        return true;
      }
    }
  } catch (e) {}
  console.log(`⚠️  未找到 "${label}" 按钮`);
  return false;
}

async function tryFill(page, selectors, value, label) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(value, { delay: 30 });
        console.log(`✅ 已填写 ${label}`);
        return true;
      }
    } catch (e) {}
  }
  console.log(`⚠️  未找到 ${label} 输入框`);
  return false;
}

async function waitForStable(page, timeout = 5000) {
  // Wait for network to be idle
  try {
    await page.waitForNetworkIdle({ timeout });
  } catch (e) {
    // Fallback to simple sleep
    await sleep(3000);
  }
}

// ============ 主流程 ============
async function main() {
  ensureDir(SCREENSHOT_DIR);

  if (!fs.existsSync(ZIP_PATH)) {
    console.error('❌ ZIP 文件不存在:', ZIP_PATH);
    process.exit(1);
  }
  console.log('✅ ZIP 文件:', ZIP_PATH);

  // 连接浏览器
  console.log('🔗 连接 Chrome...');
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: CHROME_DEBUG_URL });
  } catch (e) {
    console.error('❌ 无法连接 Chrome。请确保已用远程调试模式启动。');
    process.exit(1);
  }
  console.log('✅ 已连接 Chrome');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // ============ 步骤 1: 打开 Microsoft Partner Center ============
  console.log('\n📌 步骤 1: 打开 Microsoft Partner Center...');
  await page.goto(EDGE_PARTNER_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  await screenshot(page, '01-partner-center');

  // 检查是否需要登录
  const currentUrl = page.url();
  if (currentUrl.includes('login.microsoftonline.com') || currentUrl.includes('login.live.com')) {
    console.log('⚠️  需要登录 Microsoft 账号！');
    console.log('👉 请在浏览器中完成 Microsoft 账号登录...');
    console.log('   (等待最长 5 分钟)');
    
    // Wait for redirect back to Partner Center
    await page.waitForFunction(
      () => window.location.href.includes('partner.microsoft.com'),
      { timeout: 300000 }
    ).catch(() => {
      console.log('⏰ 等待超时，请确认是否已登录');
    });
    
    await sleep(3000);
    await screenshot(page, '02-after-login');
  }

  // 检查是否需要注册开发者账号
  const pageText = await page.evaluate(() => document.body.innerText);
  if (pageText.includes('Register') || pageText.includes('注册')) {
    console.log('⚠️  可能需要注册 Microsoft 开发者账号。请在浏览器中完成注册...');
    await sleep(300000);
  }

  console.log('✅ 已进入 Partner Center');
  await screenshot(page, '03-dashboard');

  // ============ 步骤 2: 创建新扩展 ============
  console.log('\n📌 步骤 2: 创建新扩展...');
  
  // 点击 "New extension" 按钮
  await tryClick(page, [
    'button[aria-label*="New extension"]',
    'button[aria-label*="新建扩展"]',
    '[data-testid="new-extension"]',
  ], 'New extension');

  await sleep(3000);
  await screenshot(page, '04-new-extension');

  // ============ 步骤 3: 上传 ZIP 文件 ============
  console.log('\n📌 步骤 3: 上传 ZIP 文件...');
  
  try {
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
    await fileInput.uploadFile(ZIP_PATH);
    console.log('✅ ZIP 文件已选择');
  } catch (e) {
    console.log('⚠️  未找到文件上传控件，尝试其他方式...');
    // Try drag and drop area
    await tryClick(page, [
      'button[aria-label*="Upload"]',
      'button[aria-label*="Browse"]',
      '.upload-area',
    ], 'Upload');
    
    await sleep(1000);
    try {
      const fileInput2 = await page.$('input[type="file"]');
      if (fileInput2) {
        await fileInput2.uploadFile(ZIP_PATH);
        console.log('✅ ZIP 文件已选择（第二次尝试）');
      }
    } catch (e2) {
      console.log('❌ 无法找到上传控件，请手动上传 ZIP 文件');
    }
  }

  // 等待上传完成
  console.log('⏳ 等待上传和处理...');
  await sleep(15000);
  await screenshot(page, '05-after-upload');

  // ============ 步骤 4: 填写扩展信息 ============
  console.log('\n📌 步骤 4: 填写扩展信息...');

  // Extension Name
  await tryFill(page, [
    'input[aria-label*="Extension name"]',
    'input[aria-label*="名称"]',
    'input[id*="name"]',
    'input[name*="name"]',
    '#extensionName',
  ], STORE_INFO.name, '扩展名称');

  await sleep(500);

  // Short description
  await tryFill(page, [
    'textarea[aria-label*="Short description"]',
    'textarea[aria-label*="简介"]',
    'input[id*="shortDescription"]',
    'input[name*="shortDescription"]',
    '#shortDescription',
  ], STORE_INFO.shortDescription, '简短描述');

  await sleep(500);

  // Long description
  await tryFill(page, [
    'textarea[aria-label*="Long description"]',
    'textarea[aria-label*="详细描述"]',
    'textarea[id*="longDescription"]',
    'textarea[id*="description"]:not([id*="short"])',
    '#longDescription',
  ], STORE_INFO.detailedDescription, '详细描述');

  await sleep(500);

  // Privacy policy URL
  await tryFill(page, [
    'input[aria-label*="Privacy"]',
    'input[aria-label*="隐私"]',
    'input[id*="privacy"]',
    'input[name*="privacyPolicyUrl"]',
  ], STORE_INFO.privacyPolicyUrl, '隐私政策 URL');

  await sleep(500);

  // Support URL
  await tryFill(page, [
    'input[aria-label*="Support"]',
    'input[aria-label*="支持"]',
    'input[id*="supportUrl"]',
    'input[name*="supportUrl"]',
  ], STORE_INFO.supportUrl, '支持 URL');

  await sleep(500);

  // Website URL
  await tryFill(page, [
    'input[aria-label*="Website"]',
    'input[aria-label*="网站"]',
    'input[id*="websiteUrl"]',
    'input[name*="websiteUrl"]',
  ], STORE_INFO.websiteUrl, '网站 URL');

  await sleep(500);

  // Category
  try {
    const categorySelectors = [
      'select[aria-label*="Category"]',
      'select[aria-label*="类别"]',
      'select[id*="category"]',
      '#category',
    ];
    for (const sel of categorySelectors) {
      const el = await page.$(sel);
      if (el) {
        // Try to select "Productivity"
        await page.evaluate((selector) => {
          const select = document.querySelector(selector);
          if (select) {
            for (const option of select.options) {
              if (option.text.includes('Productivity') || option.text.includes('生产力')) {
                option.selected = true;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }
        }, sel);
        console.log('✅ 已选择分类: Productivity');
        break;
      }
    }
  } catch (e) {
    console.log('⚠️  未找到分类选择框');
  }

  await screenshot(page, '06-form-filled');

  // ============ 步骤 5: 保存并继续 ============
  console.log('\n📌 步骤 5: 保存并继续...');

  // Try to save
  await tryClick(page, [
    'button[aria-label*="Save"]',
    'button[aria-label*="保存"]',
    'button[type="submit"]',
  ], 'Save');

  await sleep(3000);
  await screenshot(page, '07-after-save');

  // Try to continue to next step
  await tryClick(page, [
    'button[aria-label*="Next"]',
    'button[aria-label*="下一步"]',
    'button[aria-label*="Continue"]',
    'button[aria-label*="继续"]',
  ], 'Next');

  await sleep(3000);
  await screenshot(page, '08-next-step');

  // ============ 最终状态 ============
  console.log('\n' + '='.repeat(60));
  console.log('📋 Edge Add-ons 自动化流程已完成！');
  console.log('='.repeat(60));
  console.log(`
⚠️  请手动检查以下内容：

1. 确认扩展名称、描述、分类已正确填写
2. 添加至少 1 张截图（1280x800 或 640x400）  
3. 确认隐私政策 URL 已填写
4. 在 "隐私实践" 页面声明数据使用情况
5. 确认所有必填字段完成后，点击 "Submit" 或 "提交"

💡 截图已保存到: ${SCREENSHOT_DIR}
  `);

  console.log('🏁 浏览器保持打开，你可以继续手动操作。');
}

main().catch(err => {
  console.error('❌ 脚本执行出错:', err.message);
  process.exit(1);
});
