import React, { useState } from 'react';
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
  // 默认全部展开；记录被折叠的节点
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const normHref = (h: string) => {
    let s = (h || '').split('#')[0].split('?')[0];
    s = s.split('/').pop() || s;
    return s.trim().toLowerCase();
  };

  const bookmarksOf = (href: string) =>
    bookmarks.filter(bm => normHref(bm.chapterHref) === normHref(href));

  const toggleCollapse = (href: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  };

  const renderItem = (item: Chapter, level = 0) => {
    const bms = bookmarksOf(item.href);
    const hasBookmark = bms.length > 0;
    const hasChildren = !!(item.subitems && item.subitems.length > 0);
    const isCollapsed = collapsed.has(item.href);
    const isCurrent = normHref(currentHref) === normHref(item.href);

    return (
      <React.Fragment key={item.href}>
        <div className={`toc-row ${isCurrent ? 'toc-row-current' : ''}`}>
          {/* 折叠箭头 */}
          {hasChildren ? (
            <button
              className={`toc-toggle ${isCollapsed ? 'collapsed' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleCollapse(item.href); }}
              title={isCollapsed ? '展开' : '收起'}
            >
              ▾
            </button>
          ) : (
            <span className="toc-toggle-placeholder" />
          )}

          <button
            className={`toc-item ${level > 0 ? `level-${level}` : ''} ${
              isCurrent ? 'active' : ''
            } ${hasBookmark ? 'has-bookmark' : ''}`}
            onClick={() => onNavigate(item.href)}
          >
            <span className="toc-item-label">{item.label}</span>
            {tocPageMap?.[item.href] ? (
              <span className="toc-item-page">{tocPageMap[item.href]}</span>
            ) : null}
          </button>
        </div>

        {/* 当前读到的位置标记 */}
        {isCurrent && (
          <div className="toc-current">
            <span className="toc-current-label">📖 当前读到</span>
            {tocPageMap?.[item.href] ? (
              <span className="toc-current-page">P{tocPageMap[item.href]}</span>
            ) : null}
          </div>
        )}

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

        {hasChildren && !isCollapsed && item.subitems!.map(sub => renderItem(sub, level + 1))}
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