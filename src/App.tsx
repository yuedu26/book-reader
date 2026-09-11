import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useAppStore, themeMap } from './stores';
import { shouldRemindBackup } from './services/backup';
import Bookshelf from './pages/Bookshelf';
import Reader from './pages/Reader';
import Vocabulary from './pages/Vocabulary';
import Stats from './pages/Stats';
import {
  BookIcon, NoteIcon, StatsIcon,
} from './components/Icons';

function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  // 阅读页不显示 tab bar
  if (path.startsWith('/reader')) return null;

  const tabs = [
    { path: '/', label: '书架', icon: BookIcon },
    { path: '/vocabulary', label: '笔记', icon: NoteIcon },
    { path: '/stats', label: '统计', icon: StatsIcon },
  ];

  return (
    <nav className="tab-bar">
      {tabs.map(({ path: p, label, icon: Icon }) => (
        <button
          key={p}
          className={`tab-item ${location.pathname === p ? 'active' : ''}`}
          onClick={() => navigate(p)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function BackupReminder() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (shouldRemindBackup()) {
      const timer = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={() => setShow(false)}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h3>📦 备份提醒</h3>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          距离上次备份已超过 7 天，建议导出备份以防数据丢失。
        </p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => setShow(false)}>稍后再说</button>
          <button className="btn btn-primary" onClick={() => {
            import('./services/backup').then(m => m.exportBackup());
            setShow(false);
          }}>立即备份</button>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const settings = useAppStore(s => s.settings);
  const theme = themeMap[settings.theme];
  const books = useAppStore(s => s.books);

  // 检测 standalone 模式
  const [isStandalone, setIsStandalone] = useState(false);
  const [showStandaloneWarning, setShowStandaloneWarning] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || 
                       (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
    
    // 如果是 standalone 模式且没有书籍，显示提示
    if (standalone && books.length === 0) {
      setShowStandaloneWarning(true);
    }
  }, [books.length]);

  // 让 iOS 顶部状态栏/地址栏颜色跟随当前主题（阅读背景色）
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme.bg);
    // 让顶部安全区/状态栏区域背景跟随主题（standalone 下状态栏透出 body 背景）
    document.body.style.backgroundColor = theme.bg;
  }, [settings.theme, theme.bg]);

  return (
    <div className="app-container" data-theme={settings.theme} style={{
      '--bg': theme.bg,
      '--text': theme.text,
      '--card-bg': settings.theme === 'dark' ? '#2C2C2E' :
                   settings.theme === 'white' ? '#FFFFFF' :
                   theme.bg,
    } as React.CSSProperties}>
      {/* Standalone 模式提示 */}
      {showStandaloneWarning && (
        <div style={{
          padding: '12px 16px',
          background: '#FFF3CD',
          borderBottom: '1px solid #FFEAA7',
          color: '#856404',
          fontSize: 13,
          lineHeight: 1.5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <strong>️ Standalone 模式</strong>
            <div style={{ marginTop: 4 }}>
              检测到这是从主屏幕打开的。Safari 和主屏幕的数据是隔离的，需要重新导入书籍。
            </div>
          </div>
          <button 
            onClick={() => setShowStandaloneWarning(false)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              color: '#856404',
              cursor: 'pointer',
              padding: '0 8px',
            }}
          >
            ×
          </button>
        </div>
      )}

      <Routes>
        <Route path="/" element={<Bookshelf />} />
        <Route path="/reader/:bookId" element={<Reader />} />
        <Route path="/vocabulary" element={<Vocabulary />} />
        <Route path="/stats" element={<Stats />} />
      </Routes>
      <TabBar />
      <BackupReminder />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}
