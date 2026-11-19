import React from 'react';
import { formatRelativeTime } from '../utils';
import { TrashIcon, BookmarkIcon } from './Icons';
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
  tocPageMap?: Record<string, number>;
  bookmarkPageMap?: Record<string, number>;
}

export default function TOCPanel({
  open, onClose, toc, currentHref, onNavigate,
  bookmarks, onNavigateBookmark, onDeleteBookmark,
  tocPageMap, bookmarkPageMap,
}: Props) {
  // 规范化 href，用于匹配当前阅读章节 / 书签所属章节
  const normHref = (h: string) => {
    let s = (h || '').split('#')[0].split('?')[0];
    s = s.split('/').pop() || s;
    return s.trim().toLowerCase();
  };

  // 书签按所属章节归类
  const bookmarksOf = (href: string) =>
    bookmarks.filter(bm => normHref(bm.chapterHref) === normHref(href));

  const renderItem = (item: Chapter, level = 0) => {
    const bms = bookmarksOf(item.href);
    const hasBookmark = bms.length > 0;
    return (
      <React.Fragment key={item.href}>
        <button
          className={`toc-item ${level > 0 ? `level-${level}` : ''} ${
            normHref(currentHref) === normHref(item.href) ? 'active' : ''
          } ${hasBookmark ? 'has-bookmark' : ''}`}
          onClick={() => onNavigate(item.href)}
        >
          <span className="toc-item-label">{item.label}</span>
          {tocPageMap?.[item.href] ? (
            <span className="toc-item-page">{tocPageMap[item.href]}</span>
          ) : null}
        </button>

        {/* 该书签章节下挂的书签条目 */}
        {bms.map(bm => (
          <div key={bm.id} className="toc-bookmark">
            <span className="toc-bookmark-icon"><BookmarkIcon size={14} /></span>
            <div className="toc-bookmark-main" onClick={() => onNavigateBookmark(bm.cfi)}>
              <div className="toc-bookmark-firstline">{bm.firstLine || '书签'}</div>
              <div className="toc-bookmark-meta">
                {bookmarkPageMap?.[bm.id] ? `P${bookmarkPageMap[bm.id]} · ` : ''}
                {formatRelativeTime(bm.createdAt)}
              </div>
            </div>
            <button
              className="toc-bookmark-delete"
              onClick={() => onDeleteBookmark(bm.id)}
              title="删除书签"
            >
              <TrashIcon />
            </button>
          </div>
        ))}

        {item.subitems?.map(sub => renderItem(sub, level + 1))}
      </React.Fragment>
    );
  };

  return (
    <>
      <div className={`side-panel-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`side-panel ${open ? 'open' : ''}`}>
        <div className="side-panel-header">
          <div className="panel-tabs">
            <button className="panel-tab active">目录</button>
          </div>
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