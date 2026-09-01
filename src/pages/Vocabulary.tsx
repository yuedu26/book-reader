import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores';
import { formatRelativeTime, copyTextToClipboard } from '../utils';
import { TrashIcon, CheckIcon, VocabIcon, NoteIcon } from '../components/Icons';
import type { VocabularyWord } from '../types';
import {
  buildVocabularyText, exportVocabularyAsText, exportHighlightsAsText,
} from '../services/backup';

type TabKey = 'vocab' | 'notes' | 'marks';

export default function NotesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('vocab');
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const books = useAppStore(s => s.books);
  const vocabulary = useAppStore(s => s.vocabulary);
  const highlights = useAppStore(s => s.highlights);
  const removeWord = useAppStore(s => s.removeWord);
  const incrementReview = useAppStore(s => s.incrementReview);
  const removeHighlight = useAppStore(s => s.removeHighlight);
  const setNavigateTarget = useAppStore(s => s.setNavigateTarget);

  function inBook<T extends { bookId: string }>(items: T[]): T[] {
    return selectedBookId ? items.filter(x => x.bookId === selectedBookId) : items;
  }

  const vocab = inBook(vocabulary);
  const allMarks = inBook(highlights);
  const filteredNotes = inBook(highlights.filter(h => h.note && h.note.trim().length > 0));

  const bookTitle = (id: string) => books.find(b => b.id === id)?.title || '未知书籍';

  const goTo = (bookId: string, cfiRange: string) => {
    setNavigateTarget({ bookId, cfiRange });
    navigate(`/reader/${bookId}`);
  };

  const handleCopyAll = async () => {
    await copyTextToClipboard(buildVocabularyText(vocab, books));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 生词按章节分组
  const grouped = vocab.reduce<Record<string, VocabularyWord[]>>((acc, w) => {
    const key = w.chapterTitle || `章节 ${w.chapterHref}`;
    (acc[key] ||= []).push(w);
    return acc;
  }, {});

  const marksSorted = allMarks.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const notesSorted = filteredNotes.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="page-content">
      <div className="notes-header">
        <h1>笔记</h1>
      </div>

      {/* 三分类 */}
      <div className="notes-tabs">
        <button className={`notes-tab ${tab === 'vocab' ? 'active' : ''}`} onClick={() => setTab('vocab')}>
          生词本 {vocab.length > 0 && <em>{vocab.length}</em>}
        </button>
        <button className={`notes-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
          想法 {filteredNotes.length > 0 && <em>{filteredNotes.length}</em>}
        </button>
        <button className={`notes-tab ${tab === 'marks' ? 'active' : ''}`} onClick={() => setTab('marks')}>
          划线 {allMarks.length > 0 && <em>{allMarks.length}</em>}
        </button>
      </div>

      {/* 书籍筛选 */}
      <div className="vocab-filters">
        <button
          className={`vocab-filter-btn ${!selectedBookId ? 'active' : ''}`}
          onClick={() => setSelectedBookId(null)}
        >
          全部
        </button>
        {books.map(b => (
          <button
            key={b.id}
            className={`vocab-filter-btn ${selectedBookId === b.id ? 'active' : ''}`}
            onClick={() => setSelectedBookId(b.id)}
          >
            {b.title}
          </button>
        ))}
      </div>

      {/* 操作栏 */}
      <div className="notes-actions">
        {tab === 'vocab' && (
          <>
            <button className="notes-action-btn" onClick={handleCopyAll}>{copied ? '✓ 已复制' : '复制全部'}</button>
            <button className="notes-action-btn" onClick={() => exportVocabularyAsText(vocab, books)}>导出 TXT</button>
          </>
        )}
        {tab === 'notes' && (
          <button className="notes-action-btn" onClick={() => exportHighlightsAsText(filteredNotes, books, true)}>导出想法 TXT</button>
        )}
        {tab === 'marks' && (
          <button className="notes-action-btn" onClick={() => exportHighlightsAsText(allMarks, books, false)}>导出划线 TXT</button>
        )}
      </div>

      {/* 生词本 */}
      {tab === 'vocab' && (vocab.length === 0 ? (
        <div className="empty-state">
          <VocabIcon />
          <p>{selectedBookId ? '这本书还没有生词' : '生词本是空的'}</p>
          <small>阅读时选中英文单词，点「查词」自动加入</small>
        </div>
      ) : (
        Object.entries(grouped).map(([chapter, words]) => (
          <div key={chapter} className="vocab-chapter-group">
            <div className="vocab-chapter-title">
              <span>{chapter}</span>
              <span>{words.length} 个</span>
            </div>
            {words.map(w => (
              <div key={w.id} className="vocab-card">
                <div className="vocab-card-header">
                  <span className="vocab-word">{w.word}</span>
                  <div className="vocab-actions">
                    <button
                      className="vocab-action-btn"
                      onClick={() => incrementReview(w.id)}
                      title="标记已复习"
                      style={{ color: 'var(--success)' }}
                    >
                      <CheckIcon />
                    </button>
                    <button
                      className="vocab-action-btn"
                      onClick={() => { if (confirm(`确定删除 "${w.word}" 吗？`)) removeWord(w.id); }}
                      title="删除"
                      style={{ color: 'var(--danger)' }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
                {w.definition && <div className="vocab-definition">{w.definition}</div>}
                {w.context && <div className="vocab-context">"{w.context}"</div>}
                <div className="vocab-meta">
                  <span>复习 {w.reviewCount} 次</span>
                  <span>{formatRelativeTime(w.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ))
      ))}

      {/* 想法 */}
      {tab === 'notes' && (notesSorted.length === 0 ? (
        <div className="empty-state">
          <NoteIcon />
          <p>{selectedBookId ? '这本书还没有想法' : '还没有想法'}</p>
          <small>阅读时选中文字，点「想法」写下批注</small>
        </div>
      ) : (
        notesSorted.map(n => (
          <div key={n.id} className="note-item">
            <div className="note-item-main" onClick={() => goTo(n.bookId, n.cfiRange)}>
              <div className="note-quote">“{n.text}”</div>
              <div className="note-content">{n.note}</div>
              <div className="note-date">{bookTitle(n.bookId)} · {formatRelativeTime(n.updatedAt)}</div>
            </div>
            <button className="note-delete" onClick={() => { if (confirm('删除这条想法？')) removeHighlight(n.id); }} title="删除">
              <TrashIcon />
            </button>
          </div>
        ))
      ))}

      {/* 划线 */}
      {tab === 'marks' && (marksSorted.length === 0 ? (
        <div className="empty-state">
          <NoteIcon />
          <p>{selectedBookId ? '这本书还没有划线' : '还没有划线'}</p>
          <small>阅读时选中文字，点「划线」标记重点</small>
        </div>
      ) : (
        marksSorted.map(h => (
          <div key={h.id} className="note-item">
            <div className="note-item-main" onClick={() => goTo(h.bookId, h.cfiRange)}>
              <div className="note-quote">“{h.text}”</div>
              {h.note && <div className="note-content">{h.note}</div>}
              <div className="note-date">{bookTitle(h.bookId)} · {formatRelativeTime(h.updatedAt)}</div>
            </div>
            <button className="note-delete" onClick={() => { if (confirm('删除这条划线？')) removeHighlight(h.id); }} title="删除">
              <TrashIcon />
            </button>
          </div>
        ))
      ))}
    </div>
  );
}