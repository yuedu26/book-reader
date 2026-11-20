import React from 'react';
import { useAppStore, themeMap } from '../stores';
import type { ThemeName } from '../types';

const themes: ThemeName[] = ['white', 'green', 'yellow', 'brown', 'dark'];
const fonts = [
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Literata', value: 'Literata' },
  { label: '系统字体', value: '-apple-system, BlinkMacSystemFont, sans-serif' },
  { label: '宋体', value: '"Noto Serif SC", "SimSun", serif' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: Props) {
  const settings = useAppStore(s => s.settings);
  const updateSettings = useAppStore(s => s.updateSettings);

  return (
    <>
      <div className={`side-panel-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`side-panel side-panel-right ${open ? 'open' : ''}`}>
        <div className="side-panel-header">
          <h2>阅读设置</h2>
          <button className="toolbar-btn" onClick={onClose}>✕</button>
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
                onClick={() => {
                  // 整数运算避免浮点误差（1.8-0.1 会得到 1.7000000000000002，多次运算后可能跳变）
                  const v = Math.round(settings.lineHeight * 10) - 1;
                  updateSettings({ lineHeight: Math.max(12, v) / 10 });
                }}
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
                onClick={() => {
                  const v = Math.round(settings.lineHeight * 10) + 1;
                  updateSettings({ lineHeight: Math.min(30, v) / 10 });
                }}
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
