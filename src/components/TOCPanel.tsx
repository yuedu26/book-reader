import React from 'react';
import type { Chapter } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  toc: Chapter[];
  currentHref: string;
  onNavigate: (href: string) => void;
}

export default function TOCPanel({ open, onClose, toc, currentHref, onNavigate }: Props) {
  const renderItem = (item: Chapter, level = 0) => (
    <React.Fragment key={item.href}>
      <button
        className={`toc-item ${level > 0 ? `level-${level}` : ''} ${
          currentHref === item.href || currentHref.includes(item.href) ? 'active' : ''
        }`}
        onClick={() => onNavigate(item.href)}
      >
        {item.label}
      </button>
      {item.subitems?.map(sub => renderItem(sub, level + 1))}
    </React.Fragment>
  );

  return (
    <>
      <div className={`side-panel-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`side-panel ${open ? 'open' : ''}`}>
        <div className="side-panel-header">
          <h2>目录</h2>
          <button className="toolbar-btn" onClick={onClose}>✕</button>
        </div>
        <div className="side-panel-body">
          {toc.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
              暂无目录
            </div>
          ) : (
            toc.map(item => renderItem(item))
          )}
        </div>
      </div>
    </>
  );
}
