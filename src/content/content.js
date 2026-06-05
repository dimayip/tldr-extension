/**
 * TLDR Chrome插件 - Content Script
 * 负责：页面内容提取（网页/PDF/Word）、与侧边栏通信
 */

(function() {
  'use strict';
  
  // 防止重复注入
  if (window.__tldrInjected) return;
  window.__tldrInjected = true;
  
  /**
   * 主内容提取函数（暴露给background调用）
   */
  window.__tldrExtractContent = function() {
    const url = window.location.href;
    const isPDF = isPDFPage();
    const isOfficeDoc = isOfficeDocument();
    
    if (isPDF) {
      return extractPDFContent();
    } else if (isOfficeDoc) {
      return extractOfficeContent();
    } else {
      return extractWebContent();
    }
  };
  
  /**
   * 检测是否为PDF页面
   */
  function isPDFPage() {
    const url = window.location.href;
    const contentType = document.contentType || '';
    return url.endsWith('.pdf') || 
           contentType === 'application/pdf' ||
           document.querySelector('embed[type="application/pdf"]') !== null ||
           document.querySelector('#viewer.pdfViewer') !== null ||
           document.title.includes('.pdf');
  }
  
  /**
   * 检测是否为Office文档
   */
  function isOfficeDocument() {
    const url = window.location.href.toLowerCase();
    return url.includes('.docx') || url.includes('.doc') || 
           url.includes('.xlsx') || url.includes('.xls') ||
           url.includes('.pptx') || url.includes('.ppt') ||
           // Google Docs/Office Online
           url.includes('docs.google.com') ||
           url.includes('office.live.com') ||
           url.includes('onedrive.live.com');
  }
  
  /**
   * 提取PDF内容
   */
  function extractPDFContent() {
    let content = '';
    let title = document.title || 'PDF文档';
    
    // 尝试从PDF.js viewer提取
    const pdfViewer = document.querySelector('#viewer');
    if (pdfViewer) {
      const textLayers = pdfViewer.querySelectorAll('.textLayer');
      const texts = [];
      textLayers.forEach(layer => {
        const spans = layer.querySelectorAll('span');
        spans.forEach(span => {
          if (span.textContent.trim()) {
            texts.push(span.textContent.trim());
          }
        });
      });
      content = texts.join(' ');
    }
    
    // 尝试从embed/iframe提取
    if (!content) {
      const embed = document.querySelector('embed[type="application/pdf"]');
      if (embed) {
        content = `[PDF文件: ${embed.src || window.location.href}]\n无法直接提取PDF文本内容，请使用浏览器内置PDF查看器打开后再试。`;
      }
    }
    
    // 尝试获取页面中的任何文本
    if (!content) {
      content = document.body?.innerText || document.body?.textContent || '';
    }
    
    return {
      title: title.replace(/\.pdf$/i, ''),
      url: window.location.href,
      content: content.substring(0, 50000),
      type: 'pdf',
      wordCount: content.split(/\s+/).filter(Boolean).length
    };
  }
  
  /**
   * 提取Office文档内容
   */
  function extractOfficeContent() {
    const url = window.location.href;
    let content = '';
    let title = document.title || '文档';
    
    // Google Docs
    if (url.includes('docs.google.com')) {
      // Google Docs的内容在特殊的div中
      const docsContent = document.querySelector('.kix-page-content-block') ||
                          document.querySelector('[role="document"]') ||
                          document.querySelector('.docs-editor-container');
      if (docsContent) {
        content = docsContent.innerText || docsContent.textContent || '';
      }
      
      // Google Sheets
      const sheetsContent = document.querySelector('.grid-container');
      if (sheetsContent) {
        content = sheetsContent.innerText || '';
      }
    }
    
    // Office Online / OneDrive
    if (url.includes('office.live.com') || url.includes('onedrive.live.com')) {
      const officeContent = document.querySelector('[data-automation-id="documentContent"]') ||
                            document.querySelector('.WACViewPanel') ||
                            document.querySelector('#WACViewPanel');
      if (officeContent) {
        content = officeContent.innerText || officeContent.textContent || '';
      }
    }
    
    // 通用fallback
    if (!content) {
      content = extractWebContent().content;
    }
    
    return {
      title,
      url,
      content: content.substring(0, 50000),
      type: 'office',
      wordCount: content.split(/\s+/).filter(Boolean).length
    };
  }
  
  /**
   * 提取网页内容（核心算法）
   */
  function extractWebContent() {
    const title = document.title || '';
    const url = window.location.href;
    
    // 获取meta描述
    const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
    const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';
    
    // 克隆文档以避免修改原始DOM
    const docClone = document.cloneNode(true);
    
    // 移除噪音元素
    const noiseSelectors = [
      'script', 'style', 'noscript', 'iframe',
      'nav', 'header', 'footer',
      '.nav', '.navigation', '.menu', '.sidebar',
      '.advertisement', '.ads', '.ad', '.banner',
      '.cookie', '.popup', '.modal', '.overlay',
      '.social-share', '.share-buttons',
      '.comments', '.comment-section',
      '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
      '.breadcrumb', '.pagination',
      'aside'
    ];
    
    noiseSelectors.forEach(sel => {
      try {
        docClone.querySelectorAll(sel).forEach(el => el.remove());
      } catch(e) {}
    });
    
    // 智能内容区域检测
    const contentSelectors = [
      'article',
      '[role="main"]',
      'main',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content-body',
      '.article-body',
      '#article-content',
      '#main-content',
      '.main-content',
      '#content',
      '.content'
    ];
    
    let mainContent = null;
    let maxScore = 0;
    
    // 评分算法选择最佳内容区域
    for (const sel of contentSelectors) {
      const el = docClone.querySelector(sel);
      if (el) {
        const text = el.innerText || el.textContent || '';
        const score = scoreContentElement(el, text);
        if (score > maxScore) {
          maxScore = score;
          mainContent = el;
        }
      }
    }
    
    // 如果没找到合适的内容区域，使用body
    if (!mainContent || maxScore < 100) {
      mainContent = docClone.body;
    }
    
    let content = mainContent ? (mainContent.innerText || mainContent.textContent || '') : '';
    
    // 清理文本
    content = cleanText(content);
    
    // 提取结构化信息
    const headings = extractHeadings(document);
    const links = extractImportantLinks(document);
    
    return {
      title,
      url,
      content: content.substring(0, 50000),
      metaDescription: metaDesc,
      headings: headings.slice(0, 20),
      type: 'webpage',
      wordCount: content.split(/\s+/).filter(Boolean).length
    };
  }
  
  /**
   * 内容元素评分
   */
  function scoreContentElement(el, text) {
    let score = 0;
    const textLength = text.trim().length;
    
    if (textLength < 100) return 0;
    
    // 文本长度加分
    score += Math.min(textLength / 100, 200);
    
    // 段落数量加分
    const paragraphs = el.querySelectorAll('p');
    score += paragraphs.length * 10;
    
    // 标题加分
    const headings = el.querySelectorAll('h1,h2,h3,h4,h5,h6');
    score += headings.length * 5;
    
    // 链接密度减分（链接太多说明是导航区域）
    const links = el.querySelectorAll('a');
    const linkTextLength = Array.from(links).reduce((sum, a) => sum + (a.textContent?.length || 0), 0);
    const linkDensity = textLength > 0 ? linkTextLength / textLength : 0;
    if (linkDensity > 0.5) score -= 100;
    
    return score;
  }
  
  /**
   * 提取页面标题结构
   */
  function extractHeadings(doc) {
    const headings = [];
    doc.querySelectorAll('h1,h2,h3,h4').forEach(h => {
      const text = h.textContent?.trim();
      if (text && text.length > 2 && text.length < 200) {
        headings.push({
          level: parseInt(h.tagName[1]),
          text
        });
      }
    });
    return headings;
  }
  
  /**
   * 提取重要链接
   */
  function extractImportantLinks(doc) {
    const links = [];
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      const text = a.textContent?.trim();
      if (text && text.length > 3 && href && !href.startsWith('javascript:')) {
        links.push({ text, href });
      }
    });
    return links.slice(0, 20);
  }
  
  /**
   * 清理文本
   */
  function cleanText(text) {
    return text
      .replace(/\t/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/gm, '')
      .trim();
  }
  
  // 监听来自background的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_CONTENT') {
      try {
        const content = window.__tldrExtractContent();
        sendResponse({ success: true, data: content });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (message.type === 'SUMMARIZE_SELECTION') {
      // 通知侧边栏有选中文本需要总结
      chrome.runtime.sendMessage({
        type: 'SELECTION_TO_SUMMARIZE',
        text: message.text
      });
    }

    if (message.type === 'TLDR_TOGGLE_TRANSLATE') {
      try {
        if (message.enable) {
          Translation.enable(message.target || 'zh');
        } else {
          Translation.disable();
        }
        sendResponse({ ok: true, enabled: Translation.enabled });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return true;
    }

    if (message.type === 'TLDR_TRANSLATE_STATUS') {
      sendResponse({ enabled: Translation.enabled, target: Translation.target });
      return true;
    }
  });

  // ========== 沉浸式翻译模块 ==========
  const TLDR_TRANS_STYLE_ID = '__tldr_translation_style__';
  const TLDR_TRANS_CLASS = 'tldr-translation-block';
  const TLDR_TRANS_LOADING_CLASS = 'tldr-translation-loading';
  const TLDR_TRANS_SIMILAR_CLASS = 'tldr-translation-similar';
  const TLDR_TRANS_ATTR = 'data-tldr-translated';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'INPUT', 'BUTTON', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'NAV', 'HEADER', 'FOOTER']);
  const CANDIDATE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption, td, th, article > div';

  function injectTranslationStyle() {
    if (document.getElementById(TLDR_TRANS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = TLDR_TRANS_STYLE_ID;
    style.textContent = `
.${TLDR_TRANS_CLASS} {
  display: block !important;
  margin: 4px 0 8px !important;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  color: inherit !important;
  font-size: inherit !important;
  line-height: 1.65 !important;
  border-radius: 0 !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
  font-family: inherit !important;
}
/* 原文与目标语言为相近书写系统（CJK 互译、拉丁字母互译等）时，加背景色辅助区分 */
.${TLDR_TRANS_CLASS}.${TLDR_TRANS_SIMILAR_CLASS} {
  background: rgba(99, 102, 241, 0.08) !important;
  padding: 2px 6px !important;
  border-radius: 3px !important;
  margin: 4px 0 8px !important;
}
.${TLDR_TRANS_CLASS}.${TLDR_TRANS_LOADING_CLASS} {
  color: #94a3b8 !important;
  font-style: italic !important;
  background: transparent !important;
  padding: 0 !important;
}
.${TLDR_TRANS_CLASS}.${TLDR_TRANS_LOADING_CLASS}::after {
  content: ' …';
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function shouldSkip(node) {
    if (!node || !node.tagName) return true;
    if (SKIP_TAGS.has(node.tagName)) return true;
    if (node.hasAttribute(TLDR_TRANS_ATTR)) return true;
    if (node.classList.contains(TLDR_TRANS_CLASS)) return true;
    if (node.closest(`.${TLDR_TRANS_CLASS}`)) return true;
    // 跳过节点内部包含子段落的（避免重复翻译父子）
    if (node.querySelector('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre')) return true;
    // 内部含独立代码块的段落（如 <p><pre>...）不翻译
    if (node.querySelector('pre')) return true;
    // 整段几乎都是代码（行内 code 占比 > 60%）时也跳过
    const totalLen = (node.innerText || '').trim().length;
    if (totalLen > 0) {
      let codeLen = 0;
      node.querySelectorAll('code, kbd, samp, var, tt').forEach(el => {
        codeLen += (el.innerText || el.textContent || '').length;
      });
      if (codeLen / totalLen > 0.6) return true;
    }
    return false;
  }

  /** 内联代码 / 不译标签 */
  const INLINE_KEEP_TAGS = ['CODE', 'KBD', 'SAMP', 'VAR', 'TT'];

  /**
   * 把 inline code/kbd/samp/var/tt 等内容用占位符圈起来，避免被翻译。
   * 同时也用占位符圈住裸 URL，避免被 AI 改写。
   * 返回 { text, placeholders }，text 用于送给 AI，placeholders 用于回写时还原。
   */
  function extractTextWithPlaceholders(node) {
    if (!node) return { text: '', placeholders: [] };
    const clone = node.cloneNode(true);
    const placeholders = [];
    let idx = 0;

    INLINE_KEEP_TAGS.forEach(tag => {
      clone.querySelectorAll(tag).forEach(el => {
        const ph = `⟪K${idx}⟫`;
        const content = el.textContent || '';
        if (!content) return;
        placeholders.push({ ph, content });
        el.replaceWith(clone.ownerDocument.createTextNode(ph));
        idx++;
      });
    });

    let text = (clone.innerText || clone.textContent || '').trim();

    // 用占位符替换裸 URL（http/https）
    text = text.replace(/https?:\/\/[^\s)]+/g, (m) => {
      const ph = `⟪K${idx}⟫`;
      placeholders.push({ ph, content: m });
      idx++;
      return ph;
    });

    return { text, placeholders };
  }

  /**
   * 恢复占位符为原始内容
   */
  function restorePlaceholders(text, placeholders) {
    if (!text || !placeholders || placeholders.length === 0) return text;
    let out = text;
    for (const p of placeholders) {
      // 容错：模型可能去掉/替换 ⟪⟫ 字符或加空格，做几次替换尝试
      out = out.split(p.ph).join(p.content);
      out = out.replace(new RegExp('K' + p.ph.match(/K(\d+)/)[1] + '(?![0-9])', 'g'), p.content);
    }
    return out;
  }

  // 根据 BCP 47 语言代码粗略推断书写系统并判断文本是否已是目标语言
  function looksLike(text, target) {
    if (!text || !target) return false;
    const code = String(target).toLowerCase();
    const len = text.length;
    if (len === 0) return false;

    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const cyrillic = (text.match(/[\u0400-\u04ff]/g) || []).length;
    const arabic = (text.match(/[\u0600-\u06ff\u0750-\u077f]/g) || []).length;
    const devanagari = (text.match(/[\u0900-\u097f]/g) || []).length;
    const thai = (text.match(/[\u0e00-\u0e7f]/g) || []).length;
    const hiragana = (text.match(/[\u3040-\u309f]/g) || []).length;
    const katakana = (text.match(/[\u30a0-\u30ff]/g) || []).length;
    const hangul = (text.match(/[\uac00-\ud7af]/g) || []).length;

    // 中文系：以 CJK 字符为主（且日文假名很少）
    if (code.startsWith('zh')) {
      return cjk / len > 0.3 && (hiragana + katakana) / len < 0.05 && hangul / len < 0.05;
    }
    if (code.startsWith('ja')) {
      return (hiragana + katakana) / len > 0.05 || (cjk / len > 0.3 && hangul === 0);
    }
    if (code.startsWith('ko')) {
      return hangul / len > 0.2;
    }
    if (code.startsWith('ru') || code.startsWith('uk') || code.startsWith('bg') || code.startsWith('sr')) {
      return cyrillic / len > 0.3;
    }
    if (code.startsWith('ar') || code.startsWith('fa') || code.startsWith('ur')) {
      return arabic / len > 0.3;
    }
    if (code.startsWith('hi') || code.startsWith('mr') || code.startsWith('ne')) {
      return devanagari / len > 0.3;
    }
    if (code.startsWith('th')) {
      return thai / len > 0.3;
    }
    // 默认按拉丁字母系（en/fr/de/es/pt/it/nl/tr/id/vi/sv/no/da/fi/pl/cs/hu/ro/ms 等）
    return cjk / len < 0.05 && cyrillic === 0 && arabic === 0 && devanagari === 0 && thai === 0 && latin / len > 0.2;
  }

  /**
   * 根据 BCP 47 语言代码归类到书写系统大类
   */
  function getScriptFamily(langCode) {
    const c = String(langCode || '').toLowerCase();
    if (c.startsWith('zh') || c.startsWith('ja') || c.startsWith('ko')) return 'cjk';
    if (c.startsWith('ru') || c.startsWith('uk') || c.startsWith('bg') || c.startsWith('sr') || c.startsWith('mk') || c.startsWith('be')) return 'cyrillic';
    if (c.startsWith('ar') || c.startsWith('fa') || c.startsWith('ur') || c.startsWith('ps')) return 'arabic';
    if (c.startsWith('hi') || c.startsWith('mr') || c.startsWith('ne') || c.startsWith('sa')) return 'devanagari';
    if (c.startsWith('th')) return 'thai';
    if (c.startsWith('he') || c.startsWith('yi')) return 'hebrew';
    if (c.startsWith('el')) return 'greek';
    // 默认拉丁字母（en/fr/de/es/pt/it/nl/sv/no/da/fi/pl/cs/hu/ro/ms/id/vi/tr/sw/...）
    return 'latin';
  }

  /**
   * 通过 Unicode 字符占比检测文本所属书写系统大类
   */
  function detectScriptFamily(text) {
    if (!text) return 'unknown';
    const len = text.length;
    if (len === 0) return 'unknown';

    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const cyrillic = (text.match(/[\u0400-\u04ff]/g) || []).length;
    const arabic = (text.match(/[\u0600-\u06ff\u0750-\u077f]/g) || []).length;
    const devanagari = (text.match(/[\u0900-\u097f]/g) || []).length;
    const thai = (text.match(/[\u0e00-\u0e7f]/g) || []).length;
    const hebrew = (text.match(/[\u0590-\u05ff]/g) || []).length;
    const greek = (text.match(/[\u0370-\u03ff]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;

    if (cjk / len > 0.3) return 'cjk';
    if (cyrillic / len > 0.3) return 'cyrillic';
    if (arabic / len > 0.3) return 'arabic';
    if (devanagari / len > 0.3) return 'devanagari';
    if (thai / len > 0.3) return 'thai';
    if (hebrew / len > 0.3) return 'hebrew';
    if (greek / len > 0.3) return 'greek';
    if (latin / len > 0.2) return 'latin';
    return 'unknown';
  }

  const Translation = {
    enabled: false,
    target: 'zh',
    observer: null,
    mutationObserver: null,
    pendingNodes: new Set(),
    flushTimer: null,
    inflight: 0,
    maxInflight: 2,

    enable(target) {
      this.target = target || 'zh';
      injectTranslationStyle();
      if (this.enabled) {
        // 已开启：清理后用新语言重新触发
        this.clearAll();
      }
      this.enabled = true;

      this.observer = new IntersectionObserver(this.onIntersect.bind(this), {
        root: null,
        rootMargin: '300px 0px',
        threshold: 0.01
      });

      this.observeAll();

      // 监听 DOM 变化（适配 SPA / 动态加载）
      this.mutationObserver = new MutationObserver((muts) => {
        if (!this.enabled) return;
        for (const m of muts) {
          m.addedNodes && m.addedNodes.forEach(n => {
            if (n.nodeType === 1) this.observeNode(n);
          });
        }
      });
      this.mutationObserver.observe(document.body, { childList: true, subtree: true });
    },

    disable() {
      this.enabled = false;
      if (this.observer) { try { this.observer.disconnect(); } catch (_) {} this.observer = null; }
      if (this.mutationObserver) { try { this.mutationObserver.disconnect(); } catch (_) {} this.mutationObserver = null; }
      this.pendingNodes.clear();
      clearTimeout(this.flushTimer);
      this.clearAll();
    },

    clearAll() {
      document.querySelectorAll(`.${TLDR_TRANS_CLASS}`).forEach(el => el.remove());
      document.querySelectorAll(`[${TLDR_TRANS_ATTR}]`).forEach(el => el.removeAttribute(TLDR_TRANS_ATTR));
    },

    observeAll() {
      document.querySelectorAll(CANDIDATE_SELECTOR).forEach(n => this.observeNode(n));
    },

    observeNode(root) {
      if (!this.observer || !root) return;
      const list = root.matches && root.matches(CANDIDATE_SELECTOR)
        ? [root, ...root.querySelectorAll(CANDIDATE_SELECTOR)]
        : (root.querySelectorAll ? Array.from(root.querySelectorAll(CANDIDATE_SELECTOR)) : []);
      list.forEach(n => {
        if (shouldSkip(n)) return;
        const text = (n.innerText || '').trim();
        if (text.length < 6) return;
        if (looksLike(text, this.target)) return; // 已经是目标语言
        try { this.observer.observe(n); } catch (_) {}
      });
    },

    onIntersect(entries) {
      entries.forEach(e => {
        if (e.isIntersecting && this.enabled) {
          if (!shouldSkip(e.target)) this.pendingNodes.add(e.target);
          try { this.observer.unobserve(e.target); } catch (_) {}
        }
      });
      this.scheduleFlush();
    },

    scheduleFlush() {
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(), 250);
    },

    async flush() {
      if (!this.enabled) return;
      if (this.inflight >= this.maxInflight) {
        this.scheduleFlush();
        return;
      }
      const all = Array.from(this.pendingNodes);
      if (all.length === 0) return;

      const batch = all.slice(0, 12);
      batch.forEach(n => this.pendingNodes.delete(n));

      // 占位
      const items = [];
      batch.forEach((node, i) => {
        if (shouldSkip(node) || !isVisible(node)) return;
        const { text, placeholders } = extractTextWithPlaceholders(node);
        if (!text || text.length < 6) return;
        if (looksLike(text, this.target)) return;
        node.setAttribute(TLDR_TRANS_ATTR, 'pending');
        this.injectPlaceholder(node);
        items.push({
          id: i,
          text: text.substring(0, 1500),
          node,
          placeholders,
          srcFamily: detectScriptFamily(text)
        });
      });

      if (items.length === 0) return;

      this.inflight++;
      try {
        // 诊断：记录每段提取后的 text + 占位符（用于排查"代码块为何被翻译"等问题）
        recordLog('content', 'translate.batch.extract', {
          url: location.href,
          target: this.target,
          batch: items.map(it => ({
            id: it.id,
            tag: it.node?.tagName,
            srcFamily: it.srcFamily,
            text: it.text,
            placeholders: it.placeholders,
            originalSnippet: (it.node?.outerHTML || '').slice(0, 800)
          }))
        });

        const payload = { items: items.map(it => ({ id: it.id, text: it.text })), target: this.target };
        const result = await chrome.runtime.sendMessage({ type: 'AI_TRANSLATE', payload });
        if (!this.enabled) return;
        if (result?.error) throw new Error(result.error);
        const map = result?.translations || {};

        const applied = [];
        items.forEach(it => {
          const raw = map[it.id] ?? map[String(it.id)];
          if (raw && typeof raw === 'string') {
            const restored = restorePlaceholders(raw, it.placeholders);
            this.applyTranslation(it.node, restored, it.srcFamily);
            applied.push({ id: it.id, raw, restored });
          } else {
            this.removePlaceholder(it.node);
            applied.push({ id: it.id, raw: null, dropped: true });
          }
        });

        recordLog('content', 'translate.batch.applied', {
          url: location.href,
          target: this.target,
          applied
        });
      } catch (err) {
        console.error('[TLDR] 翻译失败:', err);
        recordLog('content', 'translate.batch.error', { message: err.message, url: location.href });
        items.forEach(it => this.removePlaceholder(it.node));
      } finally {
        this.inflight--;
        if (this.pendingNodes.size > 0) this.scheduleFlush();
      }
    },

    injectPlaceholder(node) {
      if (node.nextElementSibling?.classList?.contains(TLDR_TRANS_CLASS)) return;
      const el = document.createElement('div');
      el.className = `${TLDR_TRANS_CLASS} ${TLDR_TRANS_LOADING_CLASS}`;
      el.textContent = '正在翻译';
      this.insertAfterOrInside(node, el);
    },

    removePlaceholder(node) {
      const next = node.nextElementSibling;
      if (next?.classList?.contains(TLDR_TRANS_CLASS)) next.remove();
      // 也清理 inside
      const inside = node.querySelector(`:scope > .${TLDR_TRANS_CLASS}`);
      if (inside) inside.remove();
      node.removeAttribute(TLDR_TRANS_ATTR);
    },

    applyTranslation(node, text, srcFamily) {
      // 当原文与目标语言书写系统相近时，添加背景色辅助区分
      const targetFamily = getScriptFamily(this.target);
      const isSimilar = srcFamily && targetFamily && srcFamily !== 'unknown' && srcFamily === targetFamily;

      let target = node.nextElementSibling;
      if (!target?.classList?.contains(TLDR_TRANS_CLASS)) {
        target = node.querySelector(`:scope > .${TLDR_TRANS_CLASS}`);
      }
      if (target) {
        target.classList.remove(TLDR_TRANS_LOADING_CLASS);
        target.classList.toggle(TLDR_TRANS_SIMILAR_CLASS, !!isSimilar);
        target.textContent = text;
      } else {
        const el = document.createElement('div');
        el.className = TLDR_TRANS_CLASS + (isSimilar ? ` ${TLDR_TRANS_SIMILAR_CLASS}` : '');
        el.textContent = text;
        this.insertAfterOrInside(node, el);
      }
      node.setAttribute(TLDR_TRANS_ATTR, 'done');
    },

    insertAfterOrInside(node, el) {
      const tag = node.tagName.toUpperCase();
      // 列表/单元格内部插入，避免破坏 table/list 结构
      if (['LI', 'TD', 'TH', 'DD'].includes(tag)) {
        node.appendChild(el);
      } else {
        node.insertAdjacentElement('afterend', el);
      }
    }
  };

  // 诊断日志（受 settings.debugMode 控制）
  const TLDR_LOG_LIMIT = 500;
  async function recordLog(scope, action, data) {
    try {
      const { debugMode } = await chrome.storage.sync.get('debugMode');
      if (!debugMode) return;
      const { tldrLogs = [] } = await chrome.storage.local.get('tldrLogs');
      tldrLogs.push({
        t: new Date().toISOString(),
        scope,
        action,
        data: tldrSafeTruncate(data)
      });
      while (tldrLogs.length > TLDR_LOG_LIMIT) tldrLogs.shift();
      await chrome.storage.local.set({ tldrLogs });
    } catch (_) { /* ignore */ }
  }
  function tldrSafeTruncate(obj, maxStr = 2000) {
    try {
      return JSON.parse(JSON.stringify(obj, (_, v) => {
        if (typeof v === 'string' && v.length > maxStr) return v.slice(0, maxStr) + `…[+${v.length - maxStr}]`;
        return v;
      }));
    } catch (_) {
      return String(obj);
    }
  }

  console.log('[TLDR] Content Script 已注入:', window.location.href);
})();
