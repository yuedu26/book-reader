import React from 'react';

interface Props {
  y: number;
  text: string;
  isSingleWord: boolean;
  onCopy: () => void;
  onHighlight: () => void;
  onNote: () => void;
  onLookup: () => void;
  onSelectParagraph: () => void;
  onClose: () => void;
}

export default function TextSelectionPopup({
  y, text, isSingleWord,
  onCopy, onHighlight, onNote, onLookup, onSelectParagraph, onClose,
}: Props) {
  // 工具条定位策略：
  // 1) 下方空间够 → 放选中文字下方 64px（iOS 菜单多在上方，下方很安全）
  // 2) 下方不够 → 放上方，间距加大到 150px（避开 iOS 上方菜单，避免被遮挡）
  // 3) 上下都不够 → 兜底放到屏幕 35% 高度处
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const GAP_BELOW = 64;
  // iOS 原生菜单在选中文字上方约占「60px 间距 + 100px 高度 ≈ 160px」，
  // 再留出工具条自身高度余量，实测需要 220px 才能完全不重叠
  const GAP_ABOVE = 220;
  const TOOLBAR_H = 86;
  let top = y + GAP_BELOW;
  const fitsBelow = top + TOOLBAR_H <= viewportH;
  if (!fitsBelow) {
    const aboveTop = y - GAP_ABOVE;
    top = aboveTop >= 8 ? aboveTop : Math.max(8, viewportH * 0.35);
  }

  return (
    <>
      <div className="text-selection-popup" style={{ top }}>
        <div className="popup-actions-row">
          <button className="popup-action-btn" onClick={onCopy} title="复制">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>复制</span>
          </button>
          {isSingleWord && (
            <button className="popup-action-btn" onClick={onLookup} title="查词">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span>查词</span>
            </button>
          )}
          <button className="popup-action-btn" onClick={onSelectParagraph} title="选中整段（解决跨页选择）">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M3 12h18M3 18h18"></path>
            </svg>
            <span>整段</span>
          </button>
          <button className="popup-action-btn" onClick={onHighlight} title="划线">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="20" x2="12" y2="10"></line>
              <line x1="18" y1="20" x2="18" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="16"></line>
            </svg>
            <span>划线</span>
          </button>
          <button className="popup-action-btn" onClick={onNote} title="写想法">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>想法</span>
          </button>
        </div>
      </div>
      {/* Invisible overlay to dismiss */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 299,
        }}
        onClick={onClose}
      />
    </>
  );
}