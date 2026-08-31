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
              <span style={{ fontSize: 12 }}>A</span>
              <input
                type="range"
                className="settings-slider"
                min={12}
                max={28}
                step={1}
                value={settings.fontSize}
                onChange={e => updateSettings({ fontSize: Number(e.target.value) })}
              />
              <span style={{ fontSize: 20 }}>A</span>
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
              <input
                type="range"
                className="settings-slider"
                min={1.2}
                max={3}
                step={0.1}
                value={settings.lineHeight}
                onChange={e => updateSettings({ lineHeight: Number(e.target.value) })}
              />
              <span className="settings-value">{settings.lineHeight.toFixed(1)}</span>
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
        </div>
      </div>
    </>
  );
}
