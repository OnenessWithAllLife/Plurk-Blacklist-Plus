// Plurk Blacklist Plus - Content Script
// 隱藏指定黑單帳號的相關留言

(function() {
  'use strict';

  // 頁面載入即先加上預先隱藏，避免使用者先看到再被隱藏
  if (document.documentElement) {
    document.documentElement.classList.add('pbe-prehide');
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.classList.add('pbe-prehide');
    }, { once: true });
  }
  // 建立／確保 Overlay 存在
  function ensureOverlay() {
    let overlay = document.getElementById('pbe-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pbe-overlay';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.innerHTML = '<div class="pbe-spinner" aria-hidden="true"></div><div class="pbe-overlay-text">正在過濾…</div>';
      (document.body || document.documentElement).appendChild(overlay);
    }
    return overlay;
  }
  function showOverlay() {
    ensureOverlay();
    if (document.documentElement) {
      document.documentElement.classList.add('pbe-prehide');
    }
  }
  function hideOverlay() {
    if (document.documentElement) {
      document.documentElement.classList.remove('pbe-prehide');
    }
  }

  // 留言串處理：過濾後再顯示
  // CSS 已經隱藏留言區塊，我們先過濾，然後才顯示
  function processAndRevealThread(container) {
    if (!container || container.dataset.pbeFiltered === '1') return;
    
    // 確保容器有 relative positioning（用於 overlay）
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    
    // 同步過濾留言（留言仍被 CSS 隱藏，使用者看不到）
    try {
      filterThreadReplies(container);
    } catch (error) {
      console.error('[PBE] Error filtering thread replies:', error);
    }
    
    // 設置屬性以顯示留言（CSS 會自動顯示，此時內容已過濾）
    container.dataset.pbeFiltered = '1';
    
    // 添加並立即移除 overlay（提供極短暫的視覺回饋，可選）
    // 由於過濾很快，overlay 可能不會被看到，但保持邏輯一致
    const overlay = document.createElement('div');
    overlay.className = 'pbe-thread-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<div class="pbe-spinner"></div>';
    container.appendChild(overlay);
    
    // 使用 requestAnimationFrame 確保 overlay 有機會顯示（如果過濾很快）
    requestAnimationFrame(() => {
      const overlayEl = container.querySelector('.pbe-thread-overlay');
      if (overlayEl) {
        overlayEl.remove();
      }
    });
  }

  // 同步過濾單一留言串容器內的留言（不包含主噗）
  function filterThreadReplies(container) {
    if (!container || !state.enabled || !state.blacklist || state.blacklist.length === 0) {
      return;
    }

    // 只處理留言，不處理主噗
    const replies = container.querySelectorAll('.response, [data-rid], .response_item');
    for (const reply of replies) {
      if (processedNodes.has(reply)) continue;
      
      if (shouldHideElement(reply)) {
        // 對個別留言加上隱藏標記
        reply.classList.add('pbe-hidden');
      }
      
      processedNodes.add(reply);
    }
  }
  // 保險機制：最長 2 秒後一定解除預先隱藏，避免異常卡住
  let pbePrehideFailSafeTimer = setTimeout(() => {
    hideOverlay();
  }, 2000);

  // 狀態管理
  let state = {
    enabled: DEFAULTS.enabled,
    blacklist: DEFAULTS.blacklist,
    fuzzyEnabled: DEFAULTS.fuzzyEnabled,
    watchdogAutoDisable: DEFAULTS.watchdogAutoDisable,
    watchdogThresholdMs: DEFAULTS.watchdogThresholdMs
  };

  // 已處理節點的追蹤（避免重複處理）
  const processedNodes = new WeakSet();
  
  // 批次處理佇列
  let pendingNodes = [];
  let throttleTimer = null;
  const THROTTLE_MS = 500;
  const BATCH_SIZE = 100;

  // 載入設定
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(Object.keys(DEFAULTS));
      state.enabled = result.enabled !== undefined ? result.enabled : DEFAULTS.enabled;
      state.blacklist = result.blacklist || DEFAULTS.blacklist;
      state.fuzzyEnabled = result.fuzzyEnabled !== undefined ? result.fuzzyEnabled : DEFAULTS.fuzzyEnabled;
      state.watchdogAutoDisable = result.watchdogAutoDisable !== undefined ? result.watchdogAutoDisable : DEFAULTS.watchdogAutoDisable;
      state.watchdogThresholdMs = result.watchdogThresholdMs || DEFAULTS.watchdogThresholdMs;
    } catch (error) {
      console.error('[PBE] Failed to load settings:', error);
    }
  }

  // 建立精準邊界比對的正規表達式
  function createExactRegex(username) {
    // 避免 @manjōmemakkari 匹配到 @manjōmemakkarittenani
    // 使用字邊界，但 @ 前可以是行首或非字元
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w])@${escaped}(?![\\w.])`, 'i');
  }

  // 檢查文字內容是否包含黑名單帳號
  function checkTextContent(text, blacklist) {
    if (!text || !blacklist || blacklist.length === 0) return false;
    
    const normalizedText = text.toLowerCase();
    
    for (const username of blacklist) {
      const normalized = normalizeUsername(username);
      
      if (state.fuzzyEnabled) {
        // 模糊匹配：包含式比對
        if (normalizedText.includes(`@${normalized}`) || normalizedText.includes(normalized)) {
          return true;
        }
      } else {
        // 精準匹配：邊界比對
        const regex = createExactRegex(normalized);
        if (regex.test(text)) {
          return true;
        }
      }
    }
    
    return false;
  }

  // 檢查連結是否指向黑名單帳號
  function checkLinks(element, blacklist) {
    if (!blacklist || blacklist.length === 0) return false;
    
    const links = element.querySelectorAll('a[href]');
    
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      
      // 匹配 https://www.plurk.com/username 或 /username（根路徑）
      const match = href.match(/https?:\/\/www\.plurk\.com\/([^\/\?#]+)/i) || 
                    href.match(/^\/([^\/\?#]+)/);
      
      if (match) {
        const linkUsername = normalizeUsername(match[1]);
        
        for (const username of blacklist) {
          const normalized = normalizeUsername(username);
          if (linkUsername === normalized) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  // 尋找發文容器（向上遍歷找到包含整則發文的容器）
  // 如果是留言，返回留言本身（不返回整個留言串容器）
  function findPlurkContainer(element) {
    if (!element) return null;
    
    // 如果是留言元素，直接返回留言本身（讓留言可以被個別隱藏）
    if (element.classList && (
      element.classList.contains('response') ||
      element.classList.contains('response_item') ||
      element.hasAttribute('data-rid')
    )) {
      return element;
    }
    
    // 檢查是否在留言串容器內（#plurk_cnt_*），如果是留言，返回留言本身
    const threadContainer = element.closest('div[id^="plurk_cnt_"]');
    if (threadContainer) {
      // 向上查找，看是否為留言
      let current = element;
      let depth = 0;
      const maxDepth = 5;
      while (current && depth < maxDepth && current !== threadContainer) {
        if (current.classList && (
          current.classList.contains('response') ||
          current.classList.contains('response_item') ||
          current.hasAttribute('data-rid')
        )) {
          return current; // 返回留言本身
        }
        current = current.parentElement;
        depth++;
      }
    }
    
    let current = element;
    let depth = 0;
    const maxDepth = 10;
    
    while (current && depth < maxDepth) {
      // Plurk 發文通常有特定的 class 或結構
      // 常見的容器選擇器（需要根據實際 DOM 調整）
      if (current.classList && (
        current.classList.contains('plurk') ||
        current.classList.contains('plurk_item') ||
        current.getAttribute('data-plurk-id') ||
        current.querySelector('[data-plurk-id]')
      )) {
        return current;
      }
      
      // 如果找到包含 data-plurk-id 的子元素，當前元素可能是容器
      if (current.querySelector && current.querySelector('[data-plurk-id]')) {
        return current;
      }
      
      current = current.parentElement;
      depth++;
    }
    
    // 如果找不到特定容器，返回最接近的 article 或具有特定結構的元素
    current = element;
    depth = 0;
    while (current && depth < maxDepth) {
      if (current.tagName === 'ARTICLE' || 
          (current.classList && current.classList.length > 0)) {
        return current;
      }
      current = current.parentElement;
      depth++;
    }
    
    return element.parentElement || element;
  }

  // 檢查單一元素是否應被隱藏
  function shouldHideElement(element) {
    if (!state.enabled || !state.blacklist || state.blacklist.length === 0) {
      return false;
    }
    
    const textContent = element.textContent || '';
    const hasBlacklistedText = checkTextContent(textContent, state.blacklist);
    const hasBlacklistedLink = checkLinks(element, state.blacklist);
    
    return hasBlacklistedText || hasBlacklistedLink;
  }

  // 處理單一節點
  function processNode(node) {
    if (!node || typeof node.nodeType === 'undefined') return;
    
    // 只處理元素節點
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    
    // 跳過已處理的節點
    if (processedNodes.has(node)) return;
    
    // 檢查是否應隱藏
    if (shouldHideElement(node)) {
      const container = findPlurkContainer(node);
      if (container && !container.classList.contains('pbe-hidden')) {
        container.classList.add('pbe-hidden');
      }
    }
    
    processedNodes.add(node);
  }

  // 批次處理節點
  function processBatch() {
    if (pendingNodes.length === 0) return;
    
    const startTime = performance.now();
    const batch = pendingNodes.splice(0, BATCH_SIZE);
    
    for (const node of batch) {
      try {
        processNode(node);
      } catch (error) {
        console.error('[PBE] Error processing node:', error);
      }
    }
    
    const elapsed = performance.now() - startTime;
    
    // 看門狗檢查
    if (elapsed > state.watchdogThresholdMs) {
      console.warn(`[PBE] Performance warning: Batch processing took ${elapsed.toFixed(2)}ms`);
      
      if (state.watchdogAutoDisable) {
        state.enabled = false;
        chrome.storage.local.set({ enabled: false });
        removeAllHidden();
        console.warn('[PBE] Auto-disabled due to performance threshold');
      }
    }
    
    // 如果還有待處理節點，繼續處理
    if (pendingNodes.length > 0) {
      scheduleBatch();
    }
  }

  // 排程批次處理
  function scheduleBatch() {
    if (throttleTimer) return;
    
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      processBatch();
    }, THROTTLE_MS);
  }

  // 新增節點到處理佇列
  function queueNode(node) {
    if (!node || processedNodes.has(node)) return;
    
    pendingNodes.push(node);
    scheduleBatch();
  }

  // 移除所有隱藏標記
  function removeAllHidden() {
    const hidden = document.querySelectorAll('.pbe-hidden');
    hidden.forEach(el => el.classList.remove('pbe-hidden'));
  }

  // 重新掃描所有發文
  function rescanAll() {
    // 清除已處理標記（保留 WeakSet 會自動處理）
    // 重新掃描所有可能的發文容器
    const candidates = document.querySelectorAll('[data-plurk-id], .plurk, .plurk_item, article');
    
    pendingNodes = [];
    for (const candidate of candidates) {
      if (!processedNodes.has(candidate)) {
        queueNode(candidate);
      }
    }
  }

  // 同步重新掃描（用於初次與 SPA 導航，避免閃爍）
  function rescanAllImmediate() {
    const candidates = document.querySelectorAll('[data-plurk-id], .plurk, .plurk_item, article');
    for (const candidate of candidates) {
      try {
        processNode(candidate);
      } catch (error) {
        // 單筆錯誤不影響整體流程
      }
    }
  }

  // 初始化 MutationObserver
  function initObserver() {
    // 追蹤最近點擊的 plurkId（用於展開留言串時識別目標容器）
    let pendingPlurkId = null;
    
    // 點擊捕獲：識別要展開的 plurkId
    document.addEventListener('click', (e) => {
      // 向上查找包含 data-plurk-id 的元素
      let target = e.target;
      let depth = 0;
      const maxDepth = 5;
      
      while (target && depth < maxDepth) {
        const plurkId = target.getAttribute('data-plurk-id');
        if (plurkId) {
          pendingPlurkId = plurkId;
          // 清除之前的 pending（避免累積）
          setTimeout(() => {
            if (pendingPlurkId === plurkId) {
              pendingPlurkId = null;
            }
          }, 2000);
          break;
        }
        target = target.parentElement;
        depth++;
      }
    }, true); // 使用捕獲階段，確保先於 Plurk 的處理
    
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // 處理新增的節點
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 檢查是否為留言串容器 (#plurk_cnt_*)
            if (node.id && node.id.startsWith('plurk_cnt_')) {
              const container = node;
              // 容器已經被 CSS 隱藏，直接處理和顯示
              processAndRevealThread(container);
              
              // 清除 pending
              pendingPlurkId = null;
              continue;
            }
            
            // 檢查是否包含留言串容器
            const threadContainer = node.querySelector && node.querySelector('div[id^="plurk_cnt_"]');
            if (threadContainer && threadContainer.dataset.pbeFiltered !== '1') {
              processAndRevealThread(threadContainer);
            }
            
            // 如果新增的節點是留言，且位於已過濾的容器內，也需要檢查
            if (node.classList && (
              node.classList.contains('response') ||
              node.classList.contains('response_item') ||
              node.hasAttribute('data-rid')
            )) {
              const parentThread = node.closest('div[id^="plurk_cnt_"]');
              if (parentThread && parentThread.dataset.pbeFiltered === '1') {
                // 容器已過濾，但新留言需要檢查
                if (shouldHideElement(node)) {
                  node.classList.add('pbe-hidden');
                }
                processedNodes.add(node);
                continue;
              }
            }
            
            // 一般節點處理（用於其他動態載入的內容）
            queueNode(node);
            
            // 也處理子節點
            if (node.querySelectorAll) {
              const children = node.querySelectorAll('[data-plurk-id], .plurk, .plurk_item, article');
              children.forEach(child => queueNode(child));
            }
          }
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    return observer;
  }

  // 初次同步快速掃描（不經過節流），之後解除預先隱藏
  function initialScanAndReveal() {
    try {
      rescanAllImmediate();
      
      // 處理 permalink 頁面：檢查是否已有留言串容器
      const existingThreads = document.querySelectorAll('div[id^="plurk_cnt_"]');
      for (const threadContainer of existingThreads) {
        if (threadContainer.dataset.pbeFiltered !== '1') {
          processAndRevealThread(threadContainer);
        }
      }
      
      // 啟動 MutationObserver 以處理之後載入的節點
      initObserver();
    } finally {
      // 解除預先隱藏
      hideOverlay();
      if (pbePrehideFailSafeTimer) {
        clearTimeout(pbePrehideFailSafeTimer);
        pbePrehideFailSafeTimer = null;
      }
    }
  }

  // 監聽 storage 變更
  function setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      
      let needsRescan = false;
      
      if (changes.enabled) {
        state.enabled = changes.enabled.newValue;
        if (!state.enabled) {
          removeAllHidden();
        } else {
          needsRescan = true;
        }
      }
      
      if (changes.blacklist) {
        state.blacklist = changes.blacklist.newValue || [];
        needsRescan = true;
      }
      
      if (changes.fuzzyEnabled) {
        state.fuzzyEnabled = changes.fuzzyEnabled.newValue;
        needsRescan = true;
      }
      
      if (changes.watchdogAutoDisable) {
        state.watchdogAutoDisable = changes.watchdogAutoDisable.newValue;
      }
      
      if (changes.watchdogThresholdMs) {
        state.watchdogThresholdMs = changes.watchdogThresholdMs.newValue;
      }
      
      if (needsRescan && state.enabled) {
        removeAllHidden();
        // 延遲重新掃描，確保 DOM 已更新
        setTimeout(() => {
          rescanAll();
        }, 100);
      }
    });
  }

  // 初始化
  async function init() {
    await loadSettings();
    
    if (state.enabled) {
      // 初次快速掃描，完成後解除預先隱藏
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          initialScanAndReveal();
        }, { once: true });
      } else {
        initialScanAndReveal();
      }
    } else {
      // 功能停用時，立即解除預先隱藏
      if (document.documentElement) {
        document.documentElement.classList.remove('pbe-prehide');
      }
      if (pbePrehideFailSafeTimer) {
        clearTimeout(pbePrehideFailSafeTimer);
        pbePrehideFailSafeTimer = null;
      }
    }
    
    // 監聽 storage 變更
    setupStorageListener();
    
    // 處理 SPA 導航（Plurk 使用 AJAX 載入內容）
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // URL 變更時顯示 overlay，立即同步掃描，避免閃爍
        showOverlay();
        setTimeout(() => {
          try {
            rescanAllImmediate();
          } finally {
            hideOverlay();
          }
        }, 0);
      }
    }, 1000);
  }

  // 啟動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

