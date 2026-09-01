import React, { useState } from 'react';
import { formatRelativeTime } from '../utils';
import { TrashIcon } from './Icons';
import type { Chapter, Bookmark } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  toc: Chapter[];
  currentHref: string;
  onNavigate: (href: string) => void;
  bookmarks: Bookmark[];
  onNavigateBookmark: (cfi: string) => void;
  onDeleteBookmark: (id: string) => void;
}

export default function TOCPanel({
  open, onClose, toc, currentHref, onNavigate,
  bookmarks, onNavigateBookmark, onDeleteBookmark,
}: Props) {
  const [tab, setTab] = useState<'toc' | 'bookmarks'>('toc');

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
          <div className="panel-tabs">
            <button className={`panel-tab ${tab === 'toc' ? 'active' : ''}`} onClick={() => setTab('toc')}>目录</button>
            <button className={`panel-tab ${tab === 'bookmarks' ? 'active' : ''}`} onClick={() => setTab('bookmarks')}>书签</button>
          </div>
          <button className="toolbar-btn" onClick={onClose}>✕</button>
        </div>
        <div className="side-panel-body">
          {tab === 'toc' ? (
            toc.length === 0 ? (
              <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
                暂无目录
              </div>
            ) : (
              toc.map(item => renderItem(item))
            )
          ) : bookmarks.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
              暂无书签
            </div>
          ) : (
            [...bookmarks].sort((a, b) => b.createdAt - a.createdAt).map(bm => (
              <div key={bm.id} className="bookmark-item">
                <div className="bookmark-info" onClick={() => onNavigateBookmark(bm.cfi)}>
                  <div className="bookmark-chapter">{bm.chapterTitle || '未知章节'}</div>
                  <div className="bookmark-date">{formatRelativeTime(bm.createdAt)}</div>
                </div>
                <button className="bookmark-delete" onClick={() => onDeleteBookmark(bm.id)} title="删除">
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}