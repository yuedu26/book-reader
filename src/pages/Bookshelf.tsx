import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores';
import { saveEpubFile } from '../services/db';
import { generateId, formatRelativeTime } from '../utils';
import { PlusIcon, TrashIcon, BookIcon } from '../components/Icons';
import type { Book } from '../types';

// 带超时的 Promise
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

// 将 blob URL 转换为 base64 data URL
async function blobUrlToBase64(blobUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve(dataUrl);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = blobUrl;
  });
}

// 解析 EPUB 元数据
async function parseEpubMetadata(buffer: ArrayBuffer): Promise<{
  title: string;
  author: string;
  cover: string | undefined;
  totalChapters: number;
}> {
  console.log('[EPUB] Starting parse...');
  const ePub = (await import('epubjs')).default;
  const book = ePub(buffer);
  
  console.log('[EPUB] Waiting for ready...');
  await Promise.race([
    book.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('EPUB ready timeout')), 10000)),
  ]);
  console.log('[EPUB] Ready');

  console.log('[EPUB] Loading metadata...');
  const metadata = await Promise.race([
    book.loaded.metadata,
    new Promise((resolve) => setTimeout(() => resolve({ title: '', creator: '' }), 5000)),
  ]);
  console.log('[EPUB] Metadata:', metadata?.title, metadata?.creator);

  // 封面：先尝试获取，失败则跳过（不阻塞导入）
  let cover: string | undefined;
  try {
    console.log('[EPUB] Getting cover...');
    const coverUrl = await Promise.race([
      book.coverUrl(),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    if (coverUrl) {
      try {
        cover = await blobUrlToBase64(coverUrl);
        console.log('[EPUB] Cover loaded and converted');
      } catch (convertErr) {
        console.warn('[EPUB] Cover conversion failed, skipping:', convertErr);
      }
    }
  } catch (err) {
    console.warn('[EPUB] Cover failed:', err);
  }

  // 章节数：先尝试获取，失败则默认为 1
  let totalChapters = 1;
  try {
    console.log('[EPUB] Getting spine...');
    const bookAny = book as any;
    if (bookAny.spine?.items?.length > 0) {
      totalChapters = bookAny.spine.items.length;
    }
    console.log('[EPUB] Total chapters:', totalChapters);
  } catch (err) {
    console.warn('[EPUB] Spine failed:', err);
  }

  // 清理（不阻塞主流程）
  try {
    book.destroy();
  } catch (destroyErr) {
    console.warn('[EPUB] Destroy failed:', destroyErr);
  }

  return {
    title: metadata?.title || '未知书名',
    author: metadata?.creator || '未知作者',
    cover,
    totalChapters,
  };
}

export default function Bookshelf() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<Book | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const books = useAppStore(s => s.books);
  const addBook = useAppStore(s => s.addBook);
  const removeBook = useAppStore(s => s.removeBook);

  const handleImport = async () => {
    const input = fileInputRef.current;
    if (!input) return;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    if (!file.name.toLowerCase().endsWith('.epub')) {
      alert('请选择 .epub 格式的文件');
      return;
    }

    setImporting(true);
    try {
      console.log('[Import] Reading file...');
      const buffer = await file.arrayBuffer();
      console.log('[Import] File read, size:', buffer.byteLength);

      console.log('[Import] Parsing metadata...');
      const meta = await parseEpubMetadata(buffer);
      console.log('[Import] Metadata parsed:', meta);

      const bookId = generateId();

      console.log('[Import] Saving to IndexedDB...');
      await saveEpubFile(bookId, buffer);
      console.log('[Import] Saved to IndexedDB');

      const book: Book = {
        id: bookId,
        title: meta.title,
        author: meta.author,
        cover: meta.cover,
        progress: 0,
        currentLocation: '',
        currentChapterHref: '',
        totalChapters: meta.totalChapters,
        addedAt: Date.now(),
        lastReadAt: Date.now(),
        fileName: file.name,
      };

      console.log('[Import] Adding to store...');
      addBook(book);
      console.log('[Import] Done!');
    } catch (err) {
      console.error('[Import] Failed:', err);
      alert(`导入失败：${err instanceof Error ? err.message : '未知错误'}\n\n请确认文件是有效的 EPUB 格式`);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = (book: Book) => {
    removeBook(book.id);
    // 同时删除 IndexedDB 中的文件
    import('../services/db').then(m => m.deleteEpubFile(book.id));
    setDeleteDialog(null);
  };

  const handleTouchStart = (book: Book) => {
    longPressTimerRef.current = setTimeout(() => {
      setDeleteDialog(book);
    }, 500); // 500ms 长按
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  return (
    <div className="page-content">
      <div className="bookshelf-header">
        <h1>书架</h1>
        <button className="import-btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          <PlusIcon className="" />
          {importing ? '导入中...' : '导入'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          style={{ display: 'none' }}
          onChange={handleImport}
        />
      </div>

      {books.length === 0 ? (
        <div className="empty-state">
          <BookIcon />
          <p>书架是空的</p>
          <small>点击右上角"导入"按钮添加 EPUB 书籍</small>
        </div>
      ) : (
        <div className="book-grid">
          {books.map(book => (
            <div
              key={book.id}
              className="book-card"
              onClick={() => navigate(`/reader/${book.id}`)}
              onTouchStart={() => handleTouchStart(book)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchEnd}
              onContextMenu={(e) => {
                e.preventDefault();
                setDeleteDialog(book);
              }}
            >
              <div className="book-cover">
                {book.cover ? (
                  <img src={book.cover} alt={book.title} />
                ) : (
                  <div className="book-cover-placeholder">{book.title}</div>
                )}
                <div className="book-progress-bar">
                  <div
                    className="book-progress-fill"
                    style={{ width: `${(book.progress || 0) * 100}%` }}
                  />
                </div>
              </div>
              <div className="book-info">
                <div className="book-title">{book.title}</div>
                <div className="book-author">{book.author}</div>
                <div className="book-meta">
                  {book.progress > 0 ? `${Math.round(book.progress * 100)}% · ` : ''}
                  {formatRelativeTime(book.lastReadAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 删除确认对话框 */}
      {deleteDialog && (
        <div className="modal-overlay" onClick={() => setDeleteDialog(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>删除书籍</h3>
            <p className="confirm-text">
              确定要删除《{deleteDialog.title}》吗？<br/>
              <small style={{color: 'var(--text-muted)'}}>（相关笔记、书签、生词也会一并删除）</small>
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteDialog(null)}>取消</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteDialog)}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
