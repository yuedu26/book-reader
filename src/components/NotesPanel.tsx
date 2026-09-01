import React, { useState } from 'react';
import { formatRelativeTime } from '../utils';
import { TrashIcon, DownloadIcon } from './Icons';
import type { Highlight } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  highlights: Highlight[]; // 当前书的全部划线
  onNavigate: (cfiRange: string) => void;
  onDelete: (id: string) => void;
  onExport: (notesOnly: boolean) => void;
}

export default function NotesPanel({ open, onClose, highlights, onNavigate, onDelete, onExport }: Props) {
  const [tab, setTab] = useState<'notes' | 'marks'>('notes');

  const notes = highlights.filter(h => h.note && h.note.trim().length > 0);
  const list = tab === 'notes' ? notes : highlights;
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      <div className={`side-panel-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`side-panel side-panel-right ${open ? 'open' : ''}`}>
        <div className="side-panel-header">
          <div className="panel-tabs">
            <button className={`panel-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>想法</button>
            <button className={`panel-tab ${tab === 'marks' ? 'active' : ''}`} onClick={() => setTab('marks')}>划线</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="toolbar-btn"
              onClick={() => onExport(tab === 'notes')}
              title="导出"
              disabled={sorted.length === 0}
              style={sorted.length === 0 ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
            >
              <DownloadIcon />
            </button>
            <button className="toolbar-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="side-panel-body">
          {sorted.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
              {tab === 'notes' ? '还没有想法' : '还没有划线'}
              <div style={{ fontSize: 13, marginTop: 8, color: 'var(--text-muted)' }}>
                {tab === 'notes' ? '选中文字后点「想法」即可记录' : '选中文字后点「划线」即可标记'}
              </div>
            </div>
          ) : (
            sorted.map((n) => (
              <div key={n.id} className="note-item">
                <div className="note-item-main" onClick={() => onNavigate(n.cfiRange)}>
                  <div className="note-quote">“{n.text}”</div>
                  {n.note && <div className="note-content">{n.note}</div>}
                  <div className="note-date">{formatRelativeTime(n.updatedAt)}</div>
                </div>
                <button className="note-delete" onClick={() => onDelete(n.id)} title="删除">
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