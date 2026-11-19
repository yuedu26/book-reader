import React from 'react';

interface Props {
  y: number;
  text: string;
  isSingleWord: boolean;
  onCopy: () => void;
  onHighlight: () => void;
  onNote: () => void;
  onLookup: () => void;
  onClose: () => void;
}

export default function TextSelectionPopup({
  y, text, isSingleWord,
  onCopy, onHighlight, onNote, onLookup, onClose,
}: Props) {
  // 工具条固定在屏幕底部：iOS 原生选择菜单贴着选中文字出现，底部固定可避开它，互不遮挡
  return (
    <>
      <div className="text-selection-popup" style={{ bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))', top: 'auto' }}>
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