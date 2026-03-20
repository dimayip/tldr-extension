# TLDR - AI阅读助手 Chrome插件

> 🚀 AI驱动的智能阅读助手，支持网页、PDF、Word文档摘要与上下文对话，类似Google NotebookLM

## ✨ 功能特性

- **📝 智能摘要** - 一键生成简短摘要、详细摘要、要点列表或文章大纲
- **💬 AI对话** - 基于当前页面内容进行上下文对话，深度理解文章
- **📄 多格式支持** - 网页、PDF（PDF.js）、Google Docs、Office Online
- **🤖 多模型支持** - OpenAI、Claude、Gemini、自定义API（兼容OpenAI格式）
- **📌 笔记管理** - 保存摘要和对话内容，支持导出
- **🖱️ 右键菜单** - 选中文本快速总结
- **⚡ 快速提问** - 预设常用问题一键提问

## 🛠️ 安装方法

### 方法一：开发者模式安装（推荐）

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 选择 `tldr-extension` 文件夹
5. 插件安装成功！

### 方法二：打包安装

```bash
# 在 chrome://extensions/ 页面点击"打包扩展程序"
# 选择 tldr-extension 文件夹，生成 .crx 文件
```

## ⚙️ 配置AI模型

安装后，点击插件图标打开侧边栏，然后点击设置图标（⚙️）进入设置页面：

### OpenAI（推荐）
- 获取API Key：https://platform.openai.com/api-keys
- 推荐模型：`gpt-4o-mini`（性价比最高）

### Claude (Anthropic)
- 获取API Key：https://console.anthropic.com/
- 推荐模型：`claude-3-5-haiku-20241022`

### Gemini（免费）
- 获取API Key：https://aistudio.google.com/app/apikey
- 推荐模型：`gemini-1.5-flash`（免费额度充足）

### 自定义API（DeepSeek、Qwen等）
- 支持任何兼容OpenAI格式的API
- DeepSeek：`https://api.deepseek.com/v1`，模型：`deepseek-chat`
- 月之暗面：`https://api.moonshot.cn/v1`，模型：`moonshot-v1-8k`

## 📖 使用方法

1. **打开任意网页/PDF** → 点击浏览器工具栏中的TLDR图标
2. **生成摘要** → 在"摘要"标签页点击"生成摘要"
3. **AI对话** → 切换到"对话"标签页，输入问题
4. **快速提问** → 点击预设问题按钮（主要观点、关键数据等）
5. **保存笔记** → 点击摘要旁的📌按钮保存到笔记

## 📁 项目结构

```
tldr-extension/
├── manifest.json              # 插件配置（MV3）
├── icons/                     # 插件图标
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── background/
    │   └── background.js      # Service Worker（AI API调用、消息路由）
    ├── content/
    │   └── content.js         # 内容脚本（页面内容提取）
    ├── sidebar/
    │   ├── sidebar.html       # 侧边栏界面
    │   ├── sidebar.css        # 侧边栏样式
    │   └── sidebar.js         # 侧边栏逻辑
    └── settings/
        ├── settings.html      # 设置页面
        ├── settings.css       # 设置样式
        └── settings.js        # 设置逻辑
```

## 🔒 隐私说明

- API Key 仅存储在本地 Chrome 存储中，不会上传到任何服务器
- 页面内容仅在你主动点击时发送给AI API
- 笔记数据存储在本地，不会同步到云端（除非你的Chrome账号开启了同步）

## 🐛 常见问题

**Q: PDF内容无法提取？**
A: 确保使用Chrome内置PDF查看器打开PDF，而非下载后用其他软件打开

**Q: 提示"请先配置API Key"？**
A: 点击设置图标（⚙️）进入设置页面配置你的AI API Key

**Q: 内容提取不完整？**
A: 点击刷新按钮（🔄）重新提取，或等待页面完全加载后再试

## 📄 许可证

MIT License
