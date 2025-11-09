// Popup Script

(function() {
  'use strict';

  const enabledSwitch = document.getElementById('enabledSwitch');
  const statusDiv = document.getElementById('status');
  const openOptionsBtn = document.getElementById('openOptionsBtn');

  // 載入狀態
  async function loadStatus() {
    try {
      const result = await chrome.storage.local.get(['enabled', 'blacklist']);
      const enabled = result.enabled !== undefined ? result.enabled : true;
      const blacklist = result.blacklist || [];
      
      enabledSwitch.checked = enabled;
      updateStatus(enabled, blacklist.length);
    } catch (error) {
      console.error('Failed to load status:', error);
      statusDiv.textContent = '載入失敗';
    }
  }

  // 更新狀態顯示
  function updateStatus(enabled, blacklistCount) {
    if (enabled) {
      statusDiv.textContent = `已啟用（${blacklistCount} 個黑名單帳號）`;
      statusDiv.style.color = '#4CAF50';
    } else {
      statusDiv.textContent = '已停用';
      statusDiv.style.color = '#999';
    }
  }

  // 切換啟用狀態
  enabledSwitch.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    try {
      await chrome.storage.local.set({ enabled });
      updateStatus(enabled, (await chrome.storage.local.get(['blacklist'])).blacklist?.length || 0);
      
      // 通知 content script（透過 storage 變更事件）
      // content script 會自動監聽 storage.onChanged
    } catch (error) {
      console.error('Failed to save enabled state:', error);
      e.target.checked = !enabled; // 恢復原狀態
    }
  });

  // 開啟設定頁面
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 監聽 storage 變更以更新顯示
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.enabled) {
        enabledSwitch.checked = changes.enabled.newValue;
      }
      loadStatus();
    }
  });

  // 初始化
  loadStatus();
})();

