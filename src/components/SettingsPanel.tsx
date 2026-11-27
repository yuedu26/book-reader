import React, { useState } from 'react';
import { useAppStore, themeMap, SYSTEM_FONT_STACK } from '../stores';
import { exportBackup } from '../services/backup';
import type { ThemeName } from '../types';

const themes: ThemeName[] = ['white', 'green', 'yellow', 'brown', 'dark'];
const fonts = [
  { label: '系统字体', value: SYSTEM_FONT_STACK },   // 默认
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Literata', value: 'Literata' },
  { label: '宋体', value: '"Noto Serif SC", "SimSun", serif' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: Props) {
  const settings = useAppStore(s => s.settings);
  const updateSettings = useAppStore(s => s.updateSettings);
  const adjustLineHeight = useAppStore(s => s.adjustLineHeight);
  const lastBackupAt = useAppStore(s => s.lastBackupAt);

  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // 用户选好文件后先缓存内容，二次确认通过后才真正写入
  const [pendingBackup, setPendingBackup] = useState<any>(null);

  // 上次备份的友好文案
  const lastBackupText = (() => {
    if (!lastBackupAt) return '尚未备份过';
    const diffMs = Date.now() - lastBackupAt;
    const day = Math.floor(diffMs / 86400000);
    if (day <= 0) return '上次备份：今天';
    if (day === 1) return '上次备份：昨天';
    if (day < 30) return `上次备份：${day} 天前`;
    return `上次备份：${new Date(lastBackupAt).toLocaleDateString()}`;
  })();

  const handleBackup = () => {
    try {
      exportBackup();
    } catch (e) {
      console.warn('[Settings] backup failed:', e);
      alert('备份失败，请重试');
    }
  };

  // 第一步：让用户挑文件并解析，成功后再弹二次确认
  const handleRestore = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // 基础校验：必须是我们导出的备份结构
        if (!data || typeof data !== 'object' || !Array.isArray(data.books)) {
          alert('备份文件格式不正确');
          return;
        }
        setPendingBackup(data);
        setRestoreConfirm(true);
      } catch {
        alert('无法读取该文件，请确认是备份的 JSON 文件');
      }
    };
    input.click();
  };

  // 第二步：确认后直接把已解析的数据写入 store（不再二次选文件）
  const handleRestoreConfirm = () => {
    if (!pendingBackup) return;
    setRestoring(true);
    try {
      useAppStore.getState().restoreAll({
        books: pendingBackup.books ?? [],
        highlights: pendingBackup.highlights ?? [],
        bookmarks: pendingBackup.bookmarks ?? [],
        vocabulary: pendingBackup.vocabulary ?? [],
        readingStats: pendingBackup.readingStats ?? [],
        settings: pendingBackup.settings ?? useAppStore.getState().settings,
        lastBackupAt: pendingBackup.timestamp ?? Date.now(),
      });
      setRestoreConfirm(false);
      setPendingBackup(null);
      // 恢复后重载，让所有页面读取新数据
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      console.warn('[Settings] restore failed:', e);
      alert('恢复失败，请检查文件是否完整');
      setRestoring(false);
    }
  };

  return (
    <>
      <div className={`side-panel-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`side-panel side-panel-right ${open ? 'open' : ''}`}>
        <div className="side-panel-header">
          <h2>阅读设置</h2>
        </div>
        <div className="side-panel-body">
          {/* Font size */}
          <div className="settings-section">
            <div className="settings-label">字体大小</div>
            <div className="settings-row">
              <button
                className="font-step-btn"
                onClick={() => updateSettings({ fontSize: Math.max(12, settings.fontSize - 1) })}
                title="减小字号"
              >
                <span style={{ fontSize: 13 }}>A</span>−
              </button>
              <input
                type="range"
                className="settings-slider"
                min={12}
                max={28}
                step={1}
                value={settings.fontSize}
                onChange={e => updateSettings({ fontSize: Number(e.target.value) })}
              />
              <button
                className="font-step-btn"
                onClick={() => updateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })}
                title="增大字号"
              >
                <span style={{ fontSize: 20 }}>A</span>＋
              </button>
              <span className="settings-value">{settings.fontSize}</span>
            </div>
          </div>

          {/* Font family */}
          <div className="settings-section">
            <div className="settings-label">字体</div>
            <div className="font-options">
              {fonts.map(f => (
                <button
                  key={f.value}
                  className={`font-option-btn ${settings.fontFamily === f.value ? 'active' : ''}`}
                  onClick={() => updateSettings({ fontFamily: f.value })}
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Theme colors */}
          <div className="settings-section">
            <div className="settings-label">背景色</div>
            <div className="theme-colors">
              {themes.map(t => (
                <button
                  key={t}
                  className={`theme-color-btn ${settings.theme === t ? 'active' : ''}`}
                  style={{ backgroundColor: themeMap[t].bg }}
                  title={themeMap[t].name}
                  onClick={() => updateSettings({ theme: t })}
                />
              ))}
            </div>
          </div>

          {/* Line height */}
          <div className="settings-section">
            <div className="settings-label">行高</div>
            <div className="settings-row">
              <button
                className="font-step-btn"
                onClick={() => adjustLineHeight(-1)}
                title="减小行高"
              >−</button>
              <input
                type="range"
                className="settings-slider"
                min={1.2}
                max={3}
                step={0.1}
                value={settings.lineHeight}
                onChange={e => updateSettings({ lineHeight: Number(e.target.value) })}
              />
              <button
                className="font-step-btn"
                onClick={() => adjustLineHeight(1)}
                title="增大行高"
              >＋</button>
              <span className="settings-value">{settings.lineHeight.toFixed(1)}</span>
            </div>
          </div>

          {/* Page margin */}
          <div className="settings-section">
            <div className="settings-label">左右页边距</div>
            <div className="settings-row">
              <button
                className="font-step-btn"
                onClick={() => updateSettings({ pageMargin: Math.max(16, (settings.pageMargin ?? 32) - 2) })}
                title="减小页边距"
              >−</button>
              <input
                type="range"
                className="settings-slider"
                min={16}
                max={64}
                step={2}
                value={settings.pageMargin ?? 32}
                onChange={e => updateSettings({ pageMargin: Number(e.target.value) })}
              />
              <button
                className="font-step-btn"
                onClick={() => updateSettings({ pageMargin: Math.min(64, (settings.pageMargin ?? 32) + 2) })}
                title="增大页边距"
              >＋</button>
              <span className="settings-value">{settings.pageMargin ?? 32}px</span>
            </div>
          </div>

          {/* Page mode */}
          <div className="settings-section">
            <div className="settings-label">翻页模式</div>
            <div className="mode-toggle">
              <button
                className={`mode-btn ${settings.pageMode === 'paginated' ? 'active' : ''}`}
                onClick={() => updateSettings({ pageMode: 'paginated' })}
              >
                左右翻页
              </button>
              <button
                className={`mode-btn ${settings.pageMode === 'scrolled' ? 'active' : ''}`}
                onClick={() => updateSettings({ pageMode: 'scrolled' })}
              >
                上下滚动
              </button>
            </div>
          </div>

          {/* 数据备份（笔记、书签、统计、设置都在 localStorage，
              清缓存/换机后会丢失，因此提供手动备份与恢复） */}
          <div className="settings-section">
            <div className="settings-label">数据备份</div>

            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleBackup}
            >
              备份数据
            </button>
            <div className="settings-hint">
              导出全部笔记、书签、生词、阅读统计和设置（不含书籍文件）
            </div>

            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: 10 }}
              onClick={handleRestore}
            >
              恢复数据
            </button>
            <div className="settings-hint">
              {lastBackupText}
            </div>

            {/* 恢复确认弹窗：覆盖式操作，必须二次确认 */}
            {restoreConfirm && (
              <div className="modal-overlay modal-overlay-top" onClick={() => setRestoreConfirm(false)}>
                <div className="modal-box" onClick={e => e.stopPropagation()}>
                  <h3>恢复数据</h3>
                  <p style={{ fontSize: 15, color: 'var(--text-secondary)', margin: '8px 0 16px', lineHeight: 1.5 }}>
                    这会<strong style={{ color: 'var(--danger)' }}>覆盖当前所有</strong>笔记、书签、生词、统计和设置。建议先备份当前数据。
                  </p>
                  <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={() => setRestoreConfirm(false)}>取消</button>
                    <button className="btn btn-primary" onClick={handleRestoreConfirm}>覆盖并恢复</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 检查更新 */}
          <div className="settings-section">
            <div className="settings-label">应用更新</div>
            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: 4 }}
              onClick={async () => {
                try {
                  if ('serviceWorker' in navigator) {
                    const reg = await navigator.serviceWorker.getRegistration();
                    if (reg) {
                      await reg.update();
                    }
                  }
                } catch (e) {
                  console.warn('[Settings] update failed:', e);
                }
                // 稍等让新版本接管，然后刷新
                setTimeout(() => window.location.reload(), 600);
              }}
            >
              检查更新并刷新
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              如果更新后界面没变化，点这里强制拉取最新版本
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
