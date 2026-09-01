import React from 'react';

// 划线高亮可选颜色（浅色系，保证正文可读）
export const HIGHLIGHT_COLORS: { value: string; name: string }[] = [
  { value: '#FFEB3B', name: '黄色' },
  { value: '#C8F7C5', name: '绿色' },
  { value: '#B3D9FF', name: '蓝色' },
  { value: '#FFC4E1', name: '粉色' },
  { value: '#FFD6A5', name: '橙色' },
];

interface Props {
  y: number;
  text: string;
  isSingleWord: boolean;
  highlightColor: string;
  onColorChange: (color: string) => void;
  onCopy: () => void;
  onHighlight: () => void;
  onNote: () => void;
  onLookup: () => void;
  onClose: () => void;
}

export default function TextSelectionPopup({
  y, text, isSingleWord, highlightColor, onColorChange,
  onCopy, onHighlight, onNote, onLookup, onClose,
}: Props) {
  // 弹条水平居中（CSS left:0/right:0/margin:auto），这里只做竖直方向的边界钳制
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const top = Math.min(Math.max(y, 8), viewportH - 140);

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
        </div>
        <div className="popup-colors-row">
          <span className="popup-colors-label">划线颜色</span>
          {HIGHLIGHT_COLORS.map(c => (
            <button
              key={c.value}
              className={`popup-color-dot ${highlightColor === c.value ? 'active' : ''}`}
              style={{ backgroundColor: c.value }}
              title={c.name}
              onClick={() => onColorChange(c.value)}
            />
          ))}
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