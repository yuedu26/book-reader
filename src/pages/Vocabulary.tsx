import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores';
import { formatRelativeTime, copyTextToClipboard } from '../utils';
import { TrashIcon, CheckIcon, VocabIcon, ChevronLeftIcon } from '../components/Icons';
import type { VocabularyWord, Highlight, Book } from '../types';
import {
  buildVocabularyText, exportVocabularyAsText, exportHighlightsAsText,
} from '../services/backup';

export default function NotesPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<'books' | 'all'>('books');
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'marks' | 'notes' | 'vocab'>('marks');
  const [copied, setCopied] = useState(false);
  const [swipedId, setSwipedId] = useState<string | null>(null); // 左滑删除中的单词
  const touchStartXRef = useRef(0);

  const books = useAppStore(s => s.books);
  const vocabulary = useAppStore(s => s.vocabulary);
  const highlights = useAppStore(s => s.highlights);
  const removeWord = useAppStore(s => s.removeWord);
  const incrementReview = useAppStore(s => s.incrementReview);
  const removeHighlight = useAppStore(s => s.removeHighlight);
  const setNavigateTarget = useAppStore(s => s.setNavigateTarget);

  const bookTitle = (id: string) => books.find(b => b.id === id)?.title || '未知书籍';

  const goTo = (bookId: string, cfiRange: string) => {
    setNavigateTarget({ bookId, cfiRange });
    navigate(`/reader/${bookId}`);
  };

  const chapterNameOf = (href: string) => {
    if (!href) return '未知章节';
    let s = href.split('#')[0].split('?')[0].split('/').pop() || href;
    s = s.replace(/\.(xhtml|html|htm)$/i, '').replace(/_split_\d+$/, '');
    return s || '未知章节';
  };

  // 每本书的标注统计
  const bookStats = books
    .map(b => {
      const hs = highlights.filter(h => h.bookId === b.id);
      const markCount = hs.filter(h => !h.note || h.note.trim().length === 0).length;
      const noteCount = hs.filter(h => h.note && h.note.trim().length > 0).length;
      const vocabCount = vocabulary.filter(v => v.bookId === b.id).length;
      const times = [
        ...hs.map(h => h.updatedAt),
        ...vocabulary.filter(v => v.bookId === b.id).map(v => v.createdAt),
      ];
      const lastAt = times.length ? Math.max(...times) : 0;
      return { book: b, markCount, noteCount, vocabCount, lastAt };
    })
    .filter(s => s.markCount + s.noteCount + s.vocabCount > 0)
    .sort((a, b) => b.lastAt - a.lastAt);

  const activeBook = activeBookId ? books.find(b => b.id === activeBookId) : null;
  const activeHighlights = activeBookId ? highlights.filter(h => h.bookId === activeBookId) : [];
  const activeMarks = activeHighlights
    .filter(h => !h.note || h.note.trim().length === 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const activeNotes = activeHighlights
    .filter(h => h.note && h.note.trim().length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const activeVocab = activeBookId ? vocabulary.filter(v => v.bookId === activeBookId) : [];

  const allMarks = highlights.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  const groupByChapter = <T extends { chapterHref: string }>(items: T[]) => {
    const m: Record<string, T[]> = {};
    for (const it of items) {
      const k = chapterNameOf(it.chapterHref);
      (m[k] ||= []).push(it);
    }
    return Object.entries(m);
  };

  const handleCopyVocab = async () => {
    await copyTextToClipboard(buildVocabularyText(activeVocab, activeBook ? [activeBook] : books, false));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ===== 书列表 =====
  if (!activeBookId) {
    return (
      <div className="page-content">
        <div className="notes-header">
          <h1>笔记</h1>
          <p className="notes-subtitle">
            {bookStats.length} 本书 · 共 {highlights.length} 条标注
          </p>
        </div>

        <div className="notes-tabs">
          <button className={`notes-tab ${view === 'books' ? 'active' : ''}`} onClick={() => setView('books')}>
            按书查看
          </button>
          <button className={`notes-tab ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>
            全部笔记
          </button>
        </div>

        {view === 'all' ? (
          allMarks.length === 0 ? (
            <div className="empty-state">
              <VocabIcon />
              <p>还没有笔记</p>
              <small>阅读时选中文字即可记录划线或想法</small>
            </div>
          ) : (
            <div className="notes-all-list">
              {allMarks.slice(0, 200).map(h => (
                <div key={h.id} className="note-item">
                  <div className="note-item-main" onClick={() => goTo(h.bookId, h.cfiRange)}>
                    <div className="note-book-tag">{bookTitle(h.bookId)}</div>
                    <div className="note-quote">“{h.text}”</div>
                    {h.note && <div className="note-content">{h.note}</div>}
                    <div className="note-date">{formatRelativeTime(h.updatedAt)}</div>
                  </div>
                  <button className="note-delete" onClick={() => removeHighlight(h.id)} title="删除">
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )
        ) : bookStats.length === 0 ? (
          <div className="empty-state">
            <VocabIcon />
            <p>还没有笔记</p>
            <small>阅读时选中文字即可记录划线或想法</small>
          </div>
        ) : (
          <div className="notes-book-list">
            {bookStats.map(({ book, markCount, noteCount, vocabCount, lastAt }) => (
              <div key={book.id} className="notes-book-card" onClick={() => { setActiveBookId(book.id); setDetailTab(markCount > 0 ? 'marks' : noteCount > 0 ? 'notes' : 'vocab'); }}>
                <div className="notes-book-cover">
                  {book.cover ? (
                    <img src={book.cover} alt={book.title} />
                  ) : (
                    <div className="notes-book-cover-ph">{(book.title || '书')[0]}</div>
                  )}
                </div>
                <div className="notes-book-main">
                  <div className="notes-book-title">{book.title}</div>
                  <div className="notes-book-stats">
                    {markCount > 0 && <span>{markCount} 条划线</span>}
                    {noteCount > 0 && <span>{noteCount} 条想法</span>}
                    {vocabCount > 0 && <span>{vocabCount} 个生词</span>}
                  </div>
                  <div className="notes-book-meta">
                    {lastAt > 0 ? formatRelativeTime(lastAt) : ''}
                    {(book.progress ?? 0) >= 0.99 ? ' · 已读完' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ===== 书详情 =====
  const marksGrouped = groupByChapter(activeMarks);
  const notesGrouped = groupByChapter(activeNotes);
  const vocabGrouped = activeVocab.reduce<Record<string, VocabularyWord[]>>((acc, w) => {
    const k = chapterNameOf(w.chapterHref);
    (acc[k] ||= []).push(w);
    return acc;
  }, {});

  return (
    <div className="page-content">
      <div className="notes-detail-header">
        <button className="toolbar-btn" onClick={() => setActiveBookId(null)}>
          <ChevronLeftIcon />
        </button>
        <h1 className="notes-detail-title">{activeBook?.title || '笔记'}</h1>
      </div>

      <div className="notes-detail-stats">
        {activeMarks.length} 条划线 · {activeNotes.length} 条想法 · {activeVocab.length} 个生词
      </div>

      <div className="notes-tabs">
        <button className={`notes-tab ${detailTab === 'marks' ? 'active' : ''}`} onClick={() => setDetailTab('marks')}>
          划线 {activeMarks.length > 0 && <em>{activeMarks.length}</em>}
        </button>
        <button className={`notes-tab ${detailTab === 'notes' ? 'active' : ''}`} onClick={() => setDetailTab('notes')}>
          想法 {activeNotes.length > 0 && <em>{activeNotes.length}</em>}
        </button>
        <button className={`notes-tab ${detailTab === 'vocab' ? 'active' : ''}`} onClick={() => setDetailTab('vocab')}>
          生词 {activeVocab.length > 0 && <em>{activeVocab.length}</em>}
        </button>
      </div>

      <div className="notes-actions">
        {detailTab === 'marks' && (
          <button className="notes-action-btn" onClick={() => exportHighlightsAsText(activeMarks, activeBook ? [activeBook] : books, false)}>导出划线 TXT</button>
        )}
        {detailTab === 'notes' && (
          <button className="notes-action-btn" onClick={() => exportHighlightsAsText(activeNotes, activeBook ? [activeBook] : books, true)}>导出想法 TXT</button>
        )}
        {detailTab === 'vocab' && (
          <>
            <button className="notes-action-btn" onClick={handleCopyVocab}>{copied ? '✓ 已复制' : '复制单词'}</button>
            <button className="notes-action-btn" onClick={() => exportVocabularyAsText(activeVocab, activeBook ? [activeBook] : books, false)}>导出单词</button>
            <button className="notes-action-btn" onClick={() => exportVocabularyAsText(activeVocab, activeBook ? [activeBook] : books, true)}>导出单词+例句</button>
          </>
        )}
      </div>

      {/* 划线 */}
      {detailTab === 'marks' && (activeMarks.length === 0 ? (
        <div className="empty-state"><p>还没有划线</p></div>
      ) : (
        marksGrouped.map(([chapter, items]) => (
          <div key={chapter} className="notes-chapter-group">
            <div className="notes-chapter-title">{chapter}</div>
            {items.map(h => (
              <div key={h.id} className="note-item">
                <div className="note-item-main" onClick={() => goTo(h.bookId, h.cfiRange)}>
                  <div className="note-quote">“{h.text}”</div>
                  {h.note && <div className="note-content">{h.note}</div>}
                  <div className="note-date">{formatRelativeTime(h.updatedAt)}</div>
                </div>
                <button className="note-delete" onClick={() => removeHighlight(h.id)} title="删除">
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        ))
      ))}

      {/* 想法 */}
      {detailTab === 'notes' && (activeNotes.length === 0 ? (
        <div className="empty-state"><p>还没有想法</p></div>
      ) : (
        notesGrouped.map(([chapter, items]) => (
          <div key={chapter} className="notes-chapter-group">
            <div className="notes-chapter-title">{chapter}</div>
            {items.map(h => (
              <div key={h.id} className="note-item">
                <div className="note-item-main" onClick={() => goTo(h.bookId, h.cfiRange)}>
                  <div className="note-quote">“{h.text}”</div>
                  <div className="note-content">{h.note}</div>
                  <div className="note-date">{formatRelativeTime(h.updatedAt)}</div>
                </div>
                <button className="note-delete" onClick={() => removeHighlight(h.id)} title="删除">
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        ))
      ))}

      {/* 生词 */}
      {detailTab === 'vocab' && (activeVocab.length === 0 ? (
        <div className="empty-state">
          <VocabIcon />
          <p>这本书还没有生词</p>
          <small>阅读时选中英文单词，点「查词」自动加入</small>
        </div>
      ) : (
        Object.entries(vocabGrouped).map(([chapter, words]) => (
          <div key={chapter} className="vocab-chapter-group">
            <div className="vocab-chapter-title">
              <span>{chapter}</span>
              <span>{words.length} 个</span>
            </div>
            {words.map(w => (
              <div key={w.id} className="vocab-swipe-wrap">
                {/* 可左滑的内容层 */}
                <div
                  className={`vocab-card ${swipedId === w.id ? 'swiped' : ''}`}
                  onTouchStart={e => { touchStartXRef.current = e.touches[0].clientX; }}
                  onTouchEnd={e => {
                    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
                    if (dx < -50) setSwipedId(w.id);        // 左滑 → 露出删除
                    else if (dx > 30) setSwipedId(null);    // 右滑 → 收起
                  }}
                >
                  <div className="vocab-card-header">
                    <span className="vocab-word">{w.word}</span>
                    <button
                      className="vocab-review-btn"
                      onClick={() => incrementReview(w.id)}
                      title="标记已复习"
                    >
                      <CheckIcon /> {w.reviewCount}
                    </button>
                  </div>
                  {w.context && <div className="vocab-context">"{w.context}"</div>}
                  <div className="vocab-meta">
                    <span>{formatRelativeTime(w.createdAt)}</span>
                  </div>
                </div>
                {/* 左滑露出的删除按钮 */}
                <button
                  className="vocab-swipe-delete"
                  onClick={() => { setSwipedId(null); removeWord(w.id); }}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        ))
      ))}
    </div>
  );
}