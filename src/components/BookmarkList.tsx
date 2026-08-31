import React from 'react';
import { formatRelativeTime } from '../utils';
import { TrashIcon } from './Icons';
import type { Bookmark } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  onNavigate: (cfi: string) => void;
  onDelete: (id: string) => void;
}

export default function BookmarkList({ open, onClose, bookmarks, onNavigate, onDelete }: Props) {
  return (
    <>
      <div className={`side-panel-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`side-panel side-panel-right ${open ? 'open' : ''}`}>
        <div className="side-panel-header">
          <h2>书签</h2>
          <button className="toolbar-btn" onClick={onClose}>✕</button>
        </div>
        <div className="side-panel-body">
          {bookmarks.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
              暂无书签
            </div>
          ) : (
            bookmarks
              .sort((a, b) => b.createdAt - a.createdAt)
              .map(bm => (
                <div key={bm.id} className="bookmark-item">
                  <div className="bookmark-info" onClick={() => onNavigate(bm.cfi)}>
                    <div className="bookmark-chapter">{bm.chapterTitle || '未知章节'}</div>
                    <div className="bookmark-date">{formatRelativeTime(bm.createdAt)}</div>
                  </div>
                  <button className="bookmark-delete" onClick={() => onDelete(bm.id)}>
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
