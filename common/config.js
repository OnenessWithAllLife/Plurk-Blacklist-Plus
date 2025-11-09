// Common Configuration and Utilities
// 共用設定與工具函數

// 設定預設值
const DEFAULTS = {
  enabled: true,
  blacklist: [],
  fuzzyEnabled: false,
  watchdogAutoDisable: false,
  watchdogThresholdMs: 500
};

// 正規化使用者名稱（轉小寫、去空白）
function normalizeUsername(username) {
  return username.trim().toLowerCase().replace(/^@/, '');
}

