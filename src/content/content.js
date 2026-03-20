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
  });
  
  console.log('[TLDR] Content Script 已注入:', window.location.href);
})();
