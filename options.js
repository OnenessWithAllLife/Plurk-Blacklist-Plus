// Options Page Script

(function() {
  'use strict';

  // DOM 元素
  const usernameInput = document.getElementById('usernameInput');
  const addBtn = document.getElementById('addBtn');
  const blacklistList = document.getElementById('blacklistList');
  const fuzzyEnabledSwitch = document.getElementById('fuzzyEnabled');
  const watchdogAutoDisableSwitch = document.getElementById('watchdogAutoDisable');
  const messageDiv = document.getElementById('message');

  // 顯示訊息
  function showMessage(text, type = 'success') {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type} show`;
    setTimeout(() => {
      messageDiv.classList.remove('show');
    }, 3000);
  }

  // 載入設定
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(Object.keys(DEFAULTS));
      const blacklist = result.blacklist || DEFAULTS.blacklist;
      const fuzzyEnabled = result.fuzzyEnabled !== undefined ? result.fuzzyEnabled : DEFAULTS.fuzzyEnabled;
      const watchdogAutoDisable = result.watchdogAutoDisable !== undefined ? result.watchdogAutoDisable : DEFAULTS.watchdogAutoDisable;

      fuzzyEnabledSwitch.checked = fuzzyEnabled;
      watchdogAutoDisableSwitch.checked = watchdogAutoDisable;

      renderBlacklist(blacklist);
    } catch (error) {
      console.error('Failed to load settings:', error);
      showMessage('載入設定失敗', 'error');
    }
  }

  // 儲存設定
  async function saveSettings(updates) {
    try {
      await chrome.storage.local.set(updates);
      showMessage('設定已儲存');
    } catch (error) {
      console.error('Failed to save settings:', error);
      showMessage('儲存設定失敗', 'error');
    }
  }

  // 渲染黑名單列表
  function renderBlacklist(blacklist) {
    if (!blacklist || blacklist.length === 0) {
      blacklistList.innerHTML = '<li class="empty-state">目前沒有黑名單帳號</li>';
      return;
    }

    blacklistList.innerHTML = blacklist.map(username => `
      <li class="blacklist-item">
        <span class="blacklist-username">@${username}</span>
        <button class="btn-danger" data-username="${username}">刪除</button>
      </li>
    `).join('');

    // 綁定刪除按鈕事件
    blacklistList.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const username = e.target.getAttribute('data-username');
        await removeFromBlacklist(username);
      });
    });
  }

  // 新增到黑名單
  async function addToBlacklist(username) {
    const normalized = normalizeUsername(username);
    
    if (!normalized) {
      showMessage('請輸入有效的帳號名稱', 'error');
      return;
    }

    try {
      const result = await chrome.storage.local.get(['blacklist']);
      const blacklist = result.blacklist || [];
      
      if (blacklist.includes(normalized)) {
        showMessage('此帳號已在黑名單中', 'error');
        return;
      }

      const updated = [...blacklist, normalized].sort();
      await saveSettings({ blacklist: updated });
      renderBlacklist(updated);
      usernameInput.value = '';
      usernameInput.focus();
    } catch (error) {
      console.error('Failed to add to blacklist:', error);
      showMessage('新增失敗', 'error');
    }
  }

  // 從黑名單移除
  async function removeFromBlacklist(username) {
    try {
      const result = await chrome.storage.local.get(['blacklist']);
      const blacklist = result.blacklist || [];
      const updated = blacklist.filter(u => u !== username);
      
      await saveSettings({ blacklist: updated });
      renderBlacklist(updated);
    } catch (error) {
      console.error('Failed to remove from blacklist:', error);
      showMessage('刪除失敗', 'error');
    }
  }

  // 事件監聽
  addBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
      addToBlacklist(username);
    }
  });

  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const username = usernameInput.value.trim();
      if (username) {
        addToBlacklist(username);
      }
    }
  });

  fuzzyEnabledSwitch.addEventListener('change', (e) => {
    saveSettings({ fuzzyEnabled: e.target.checked });
  });

  watchdogAutoDisableSwitch.addEventListener('change', (e) => {
    saveSettings({ watchdogAutoDisable: e.target.checked });
  });

  // 初始化
  loadSettings();
})();

