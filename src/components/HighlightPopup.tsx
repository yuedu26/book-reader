import React from 'react';

interface Props {
  x: number;
  y: number;
  text: string;
  onCopy: () => void;
  onHighlight: () => void;
  onNote: () => void;
  onTranslate: () => void;
  onClose: () => void;
}

export default function TextSelectionPopup({ x, y, text, onCopy, onHighlight, onNote, onTranslate, onClose }: Props) {
  return (
    <>
      <div
        className="text-selection-popup"
        style={{ left: Math.max(8, x), top: y }}
      >
        <button className="popup-action-btn" onClick={onCopy} title="复制">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>复制</span>
        </button>
        <button className="popup-action-btn" onClick={onHighlight} title="划线">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
          <span>划线</span>
        </button>
        <button className="popup-action-btn" onClick={onNote} title="写想法">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>想法</span>
        </button>
        <button className="popup-action-btn" onClick={onTranslate} title="翻译">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 8l6 6"></path>
            <path d="M4 14l6-6 2-3"></path>
            <path d="M2 5h12"></path>
            <path d="M7 2h1"></path>
            <path d="M22 22l-5-10-5 10"></path>
            <path d="M14 18h6"></path>
          </svg>
          <span>翻译</span>
        </button>
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
