const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// ============ 配置区 ============
const CHROME_DEBUG_URL = 'http://localhost:9222';
const ZIP_PATH = path.join(__dirname, 'tldr-extension-v1.0.0.zip');
const SCREENSHOT_DIR = path.join(__dirname, 'publish-screenshots');

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
  category: '生产力工具',
  language: '中文（简体）',
  privacyPolicyUrl: 'https://github.com/dimayip/tldr-extension/blob/main/PRIVACY_POLICY.md',
};

// 权限说明
const PERMISSION_JUSTIFICATIONS = {
  'activeTab': '读取当前标签页内容以生成摘要',
  'storage': '本地存储用户的API Key和设置偏好',
  'sidePanel': '在浏览器侧边栏展示AI摘要和对话界面',
  'scripting': '在页面中注入内容脚本以提取网页文本',
  'tabs': '获取当前标签页信息以关联摘要与对应页面',
  'contextMenus': '添加右键菜单快捷入口，方便用户快速使用',
  '<all_urls> (host_permissions)': '用户可配置自定义API服务器地址（如DeepSeek、Qwen等），扩展需向用户指定的任意域名发起请求',
  '<all_urls> (content_scripts)': '在任意网页上注入内容提取脚本，支持对所有网站生成摘要',
  '<all_urls> (web_accessible_resources)': '侧边栏和设置页面需要从任何网页上下文加载资源',
};

// ============ 工具函数 ============
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`📸 截图已保存: ${filePath}`);
}

async function waitAndClick(page, selector, options = {}) {
  await page.waitForSelector(selector, { timeout: 30000, ...options });
  await page.click(selector);
  await sleep(1000);
}

async function waitAndType(page, selector, text, options = {}) {
  await page.waitForSelector(selector, { timeout: 30000, ...options });
  await page.click(selector, { clickCount: 3 }); // select all existing text
  await page.type(selector, text, { delay: 50 });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ 主流程 ============
async function main() {
  ensureDir(SCREENSHOT_DIR);

  // 验证 ZIP 文件
  if (!fs.existsSync(ZIP_PATH)) {
    console.error('❌ ZIP 文件不存在:', ZIP_PATH);
    process.exit(1);
  }
  console.log('✅ ZIP 文件已找到:', ZIP_PATH);

  // 连接浏览器
  console.log('🔗 正在连接 Chrome 浏览器...');
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: CHROME_DEBUG_URL });
  } catch (e) {
    console.error('❌ 无法连接 Chrome。请确保已用以下命令启动 Chrome:');
    console.error('   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
    process.exit(1);
  }
  console.log('✅ 已连接 Chrome 浏览器');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // 步骤 1: 打开开发者控制台
  console.log('\n📌 步骤 1: 打开 Chrome 开发者控制台...');
  await page.goto('https://chrome.google.com/webstore/devconsole', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  await screenshot(page, '01-dashboard');

  // 检查是否需要登录
  const currentUrl = page.url();
  if (currentUrl.includes('accounts.google.com')) {
    console.log('⚠️  需要登录 Google 账号。请在浏览器中完成登录，然后按 Enter 继续...');
    // 等待用户登录
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 300000 }).catch(() => {});
    await sleep(2000);
    await screenshot(page, '02-after-login');
  }

  // 检查是否需要同意服务条款
  try {
    const agreeBtn = await page.$('button[id*="accept"], button[id*="agree"], button[aria-label*="Accept"], button[aria-label*="同意"]');
    if (agreeBtn) {
      console.log('📋 检测到服务条款，点击同意...');
      await agreeBtn.click();
      await sleep(3000);
    }
  } catch (e) {
    // No terms dialog
  }

  // 检查是否需要支付开发者注册费
  const pageContent = await page.content();
  if (pageContent.includes('registration') || pageContent.includes('注册费') || pageContent.includes('$5')) {
    console.log('⚠️  检测到需要支付开发者注册费。请在浏览器中完成支付，然后按 Enter 继续...');
    await sleep(300000); // wait up to 5 minutes
  }

  console.log('✅ 已进入开发者控制台');
  await screenshot(page, '03-devconsole');

  // 步骤 2: 创建新项目
  console.log('\n📌 步骤 2: 创建新项目并上传 ZIP...');
  
  // 尝试点击 "New Item" 按钮
  try {
    // 尝试多种选择器
    const newItemSelected = await page.waitForSelector(
      'button[aria-label*="New item"], button[aria-label*="新建"], button[aria-label*="New Item"], a[aria-label*="New item"], [data-testid="new-item-button"]',
      { timeout: 10000 }
    ).catch(() => null);

    if (newItemSelected) {
      await newItemSelected.click();
      console.log('✅ 点击了 "New Item" 按钮');
    } else {
      // 尝试通过文本查找按钮
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && (text.includes('New item') || text.includes('新建项目') || text.includes('Add a new item'))) {
          await btn.click();
          console.log('✅ 通过文本匹配点击了新建按钮');
          break;
        }
      }
    }
  } catch (e) {
    console.log('⚠️  未找到 "New Item" 按钮，尝试其他方式...');
  }

  await sleep(3000);
  await screenshot(page, '04-after-new-item');

  // 上传 ZIP 文件
  console.log('📁 上传 ZIP 文件...');
  try {
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
    await fileInput.uploadFile(ZIP_PATH);
    console.log('✅ ZIP 文件已上传');
  } catch (e) {
    console.log('⚠️  未找到文件上传控件，可能需要手动上传');
    console.log('   请手动上传 ZIP 文件，然后按 Enter 继续...');
  }

  // 等待上传完成
  console.log('⏳ 等待上传和处理完成...');
  await sleep(10000);
  await screenshot(page, '05-after-upload');

  // 步骤 3: 填写商店列表信息
  console.log('\n📌 步骤 3: 填写商店列表信息...');

  // 等待表单加载
  await sleep(3000);

  // 尝试填写名称
  try {
    const nameSelectors = [
      'input[aria-label*="Name"]',
      'input[aria-label*="名称"]', 
      'input[id*="name"]',
      '#name-input',
      'input[name="name"]',
    ];
    for (const sel of nameSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(STORE_INFO.name, { delay: 50 });
        console.log('✅ 已填写扩展名称');
        break;
      }
    }
  } catch (e) {
    console.log('⚠️  未找到名称输入框');
  }

  await sleep(500);

  // 尝试填写简短描述
  try {
    const shortDescSelectors = [
      'textarea[aria-label*="Short description"]',
      'textarea[aria-label*="简介"]',
      'textarea[id*="short"]',
      'input[id*="shortDescription"]',
    ];
    for (const sel of shortDescSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(STORE_INFO.shortDescription, { delay: 30 });
        console.log('✅ 已填写简短描述');
        break;
      }
    }
  } catch (e) {
    console.log('⚠️  未找到简短描述输入框');
  }

  await sleep(500);

  // 尝试填写详细描述
  try {
    const detailDescSelectors = [
      'textarea[aria-label*="Detailed description"]',
      'textarea[aria-label*="详细描述"]',
      'textarea[id*="detailed"]',
      'textarea[id*="description"]:not([id*="short"])',
    ];
    for (const sel of detailDescSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(STORE_INFO.detailedDescription, { delay: 20 });
        console.log('✅ 已填写详细描述');
        break;
      }
    }
  } catch (e) {
    console.log('⚠️  未找到详细描述输入框');
  }

  await screenshot(page, '06-form-filled');

  // 步骤 4: 填写分类和其他选项
  console.log('\n📌 步骤 4: 填写分类和隐私信息...');

  // 尝试选择分类
  try {
    const categorySelectors = [
      'select[aria-label*="Category"]',
      'select[aria-label*="类别"]',
      'select[id*="category"]',
    ];
    for (const sel of categorySelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.select('productivity'); // 生产力工具
        console.log('✅ 已选择分类: 生产力工具');
        break;
      }
    }
  } catch (e) {
    console.log('⚠️  未找到分类选择框');
  }

  await sleep(500);

  // 填写隐私政策 URL
  try {
    const privacySelectors = [
      'input[aria-label*="Privacy"]',
      'input[aria-label*="隐私"]',
      'input[id*="privacy"]',
      'input[id*="policyUrl"]',
    ];
    for (const sel of privacySelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(STORE_INFO.privacyPolicyUrl, { delay: 30 });
        console.log('✅ 已填写隐私政策 URL');
        break;
      }
    }
  } catch (e) {
    console.log('⚠️  未找到隐私政策 URL 输入框');
  }

  await screenshot(page, '07-category-privacy');

  // 步骤 5: 保存草稿
  console.log('\n📌 步骤 5: 保存草稿...');
  try {
    const saveBtn = await page.$('button[aria-label*="Save"], button[aria-label*="保存"]');
    if (saveBtn) {
      await saveBtn.click();
      console.log('✅ 已点击保存按钮');
      await sleep(3000);
    }
  } catch (e) {
    console.log('⚠️  未找到保存按钮');
  }

  await screenshot(page, '08-saved');

  // 最终状态截图
  console.log('\n📌 最终状态截图...');
  await screenshot(page, '09-final-state');

  console.log('\n' + '='.repeat(60));
  console.log('📋 自动化流程已完成！');
  console.log('='.repeat(60));
  console.log(`
⚠️  注意：由于 Chrome Web Store 界面可能随时变化，自动填写可能不完整。
    请手动检查以下内容：

1. 确认扩展名称、描述、分类已正确填写
2. 添加至少 1 张截图（1280x800 或 640x400）
3. 确认隐私政策 URL 已填写
4. 在 "隐私实践" 页面声明数据使用情况
5. 在 "支持" 页面填写支持 URL 或邮箱
6. 确认所有必填字段完成后，点击 "提交审核"

💡 所有截图已保存到: ${SCREENSHOT_DIR}
  `);

  // 不关闭浏览器，保留用户会话
  console.log('🏁 浏览器保持打开，你可以继续手动操作。');
}

main().catch(err => {
  console.error('❌ 脚本执行出错:', err.message);
  process.exit(1);
});
