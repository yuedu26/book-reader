import React, { useState } from 'react';
import { useAppStore } from '../stores';
import { formatRelativeTime } from '../utils';
import { TrashIcon, CheckIcon, VocabIcon } from '../components/Icons';
import type { VocabularyWord } from '../types';

export default function Vocabulary() {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  const books = useAppStore(s => s.books);
  const vocabulary = useAppStore(s => s.vocabulary);
  const removeWord = useAppStore(s => s.removeWord);
  const incrementReview = useAppStore(s => s.incrementReview);

  const filtered = selectedBookId
    ? vocabulary.filter(v => v.bookId === selectedBookId)
    : vocabulary;

  // Group by chapter
  const grouped = filtered.reduce<Record<string, VocabularyWord[]>>((acc, w) => {
    const key = w.chapterTitle || `章节 ${w.chapterHref}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(w);
    return acc;
  }, {});

  const handleDelete = (word: VocabularyWord) => {
    if (confirm(`确定删除 "${word.word}" 吗？`)) {
      removeWord(word.id);
    }
  };

  return (
    <div className="page-content">
      <div className="vocab-header">
        <h1>生词本</h1>
        <p>共 {filtered.length} 个生词</p>
      </div>

      {/* Book filter */}
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

      {filtered.length === 0 ? (
        <div className="empty-state">
          <VocabIcon />
          <p>{selectedBookId ? '这本书还没有生词' : '生词本是空的'}</p>
          <small>阅读时选中英文单词，点击"词"即可加入生词本</small>
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
                      onClick={() => handleDelete(w)}
                      title="删除"
                      style={{ color: 'var(--danger)' }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
                {w.definition && (
                  <div className="vocab-definition">{w.definition}</div>
                )}
                {w.context && (
                  <div className="vocab-context">"{w.context}"</div>
                )}
                <div className="vocab-meta">
                  <span>复习 {w.reviewCount} 次</span>
                  <span>{formatRelativeTime(w.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
