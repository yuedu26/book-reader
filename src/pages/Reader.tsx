import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore, themeMap } from '../stores';
import { getEpubFile } from '../services/db';
import { generateId, copyTextToClipboard } from '../utils';
import {
  ChevronLeftIcon, ChevronRightIcon, CloseIcon,
  ListIcon, SettingsIcon, BookmarkIcon, BookmarkFilledIcon,
  NoteIcon,
} from '../components/Icons';
import SettingsPanel from '../components/SettingsPanel';
import TOCPanel from '../components/TOCPanel';
import BookmarkList from '../components/BookmarkList';
import NotesPanel from '../components/NotesPanel';
import TextSelectionPopup from '../components/HighlightPopup';
import { exportNotes } from '../services/backup';
import type { Chapter, Highlight } from '../types';

// epub.js 高亮是 SVG 矩形，颜色通过 attributes 的 `fill` 传递
function highlightStyles(color: string) {
  return { fill: color, 'fill-opacity': 0.5, 'mix-blend-mode': 'multiply' };
}

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<any>(null);

  const book = useAppStore(s => s.books.find(b => b.id === bookId));
  const updateBook = useAppStore(s => s.updateBook);
  const settings = useAppStore(s => s.settings);
  const addReadingTime = useAppStore(s => s.addReadingTime);
  const updateSettings = useAppStore(s => s.updateSettings);
  const highlights = useAppStore(s => s.highlights.filter(h => h.bookId === bookId));
  const addHighlight = useAppStore(s => s.addHighlight);
  const removeHighlight = useAppStore(s => s.removeHighlight);
  const updateHighlight = useAppStore(s => s.updateHighlight);
  const bookmarks = useAppStore(s => s.bookmarks.filter(b => b.bookId === bookId));
  const addBookmark = useAppStore(s => s.addBookmark);
  const removeBookmark = useAppStore(s => s.removeBookmark);
  const addWord = useAppStore(s => s.addWord);

  const [loading, setLoading] = useState(true);
  const [showToolbar, setShowToolbar] = useState(false); // 阅读时默认隐藏工具栏
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarkListOpen, setBookmarkListOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [toc, setToc] = useState<Chapter[]>([]);
  const [currentChapterTitle, setCurrentChapterTitle] = useState('');
  const [currentSpineIndex, setCurrentSpineIndex] = useState(0);
  const [totalSpineItems, setTotalSpineItems] = useState(0);
  const [selectionPopup, setSelectionPopup] = useState<{
    y: number; text: string; cfiRange: string; isSingleWord: boolean;
  } | null>(null);
  const [noteDialog, setNoteDialog] = useState<{
    highlightId: string; text: string; existingNote?: string;
  } | null>(null);

  const readingStartRef = useRef(Date.now());
  const locationSaveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevPageModeRef = useRef(settings.pageMode);

  // 当前书籍的「想法」（带 note 的高亮）
  const notes = highlights.filter(h => h.note && h.note.trim().length > 0);

  // Initialize epub
  useEffect(() => {
    if (!bookId) return;
    let destroyed = false;

    const initEpub = async () => {
      try {
        console.log('[Reader] Starting initialization...');
        setLoading(true);

        // 等待容器完全渲染
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const container = viewerRef.current;
        if (!container) {
          throw new Error('渲染容器未准备好');
        }

        console.log('[Reader] Container size:', container.offsetWidth, 'x', container.offsetHeight);

        // 从 IndexedDB 加载文件
        const buffer = await getEpubFile(bookId);
        if (!buffer) {
          throw new Error('无法从存储中读取书籍文件');
        }
        if (destroyed) return;
        console.log('[Reader] Buffer loaded, size:', buffer.byteLength);

        // 动态导入 epubjs
        const ePubModule = await import('epubjs');
        const ePub = ePubModule.default as any;
        
        // 创建 book 实例
        const bookInstance = ePub(buffer);
        bookRef.current = bookInstance;

        // 等待 ready，带超时
        console.log('[Reader] Waiting for book.ready...');
        await Promise.race([
          bookInstance.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('EPUB 解析超时')), 10000)),
        ]);
        console.log('[Reader] Book ready');
        if (destroyed) return;

        // 获取目录
        let tocItems: Chapter[] = [];
        try {
          const nav = await Promise.race([
            bookInstance.loaded.navigation,
            new Promise<any>((resolve) => setTimeout(() => resolve({ toc: [] }), 3000)),
          ]);
          const flattenToc = (items: any[]): Chapter[] => {
            if (!items) return [];
            return items.map((item: any) => ({
              id: item.id || '',
              label: item.label?.trim() || '',
              href: item.href || '',
              subitems: item.subitems?.length ? flattenToc(item.subitems) : undefined,
            }));
          };
          tocItems = flattenToc(nav?.toc || []);
          setToc(tocItems);
          console.log('[Reader] TOC loaded:', tocItems.length, 'items');
        } catch (err) {
          console.warn('[Reader] Failed to load TOC:', err);
        }

        console.log('[Reader] Creating rendition...');
        const rendition = bookInstance.renderTo(container, {
          width: '100%',
          height: '100%',
          flow: settings.pageMode === 'scrolled' ? 'scrolled' : 'paginated',
          spread: 'none',
          allowScriptedContent: true,
        });
        renditionRef.current = rendition;

        // 设置 spine 长度
        const spineLength = bookInstance.spine?.items?.length || 1;
        setTotalSpineItems(spineLength);
        console.log('[Reader] Spine length:', spineLength);

        // 应用主题
        applyTheme(rendition);

        // 监听 relocated 事件
        rendition.on('relocated', (location: any) => {
          if (destroyed) return;
          const cfi = location.start?.cfi;
          const href = location.start?.href;
          
          if (cfi && bookId) {
            // 防抖保存位置
            if (locationSaveTimerRef.current) clearTimeout(locationSaveTimerRef.current);
            locationSaveTimerRef.current = setTimeout(() => {
              const spinePos = bookInstance.spine?.items?.findIndex((i: any) => i.href === href) ?? -1;
              const progress = spineLength > 0
                ? (spinePos >= 0 ? spinePos : 0) / spineLength
                : 0;

              updateBook(bookId, {
                currentLocation: cfi,
                currentChapterHref: href || '',
                progress: Math.min(progress, 1),
                lastReadAt: Date.now(),
              });

              if (spinePos >= 0) setCurrentSpineIndex(spinePos);
            }, 500);
          }

          // 更新章节标题
          if (href) {
            const findTitle = (items: Chapter[]): string => {
              for (const item of items) {
                if (item.href === href || href.includes(item.href)) return item.label;
                if (item.subitems) {
                  const found = findTitle(item.subitems);
                  if (found) return found;
                }
              }
              return '';
            };
            const title = findTitle(tocItems);
            setCurrentChapterTitle(title || '');
          }

          // 点击翻页与文本选择统一在 rendered 事件里绑定（见 bindPageEvents）
        });

        // 绑定点击翻页与文本选择（每次小节渲染后对新 document 绑定，WeakSet 去重）
        const boundDocs = new WeakSet<any>();

        const bindPageEvents = (doc: any) => {
          if (!doc || boundDocs.has(doc)) return;
          boundDocs.add(doc);

          // 点击翻页：桌面与移动端 tap 都触发 click，避免 touchend+click 双翻页
          doc.addEventListener('click', (ev: MouseEvent) => {
            const win = doc.defaultView || doc.ownerDocument?.defaultView;
            const sel = win?.getSelection?.()?.toString?.();
            if (sel && sel.trim().length > 0) return;

            const width = doc.documentElement?.clientWidth || doc.body?.clientWidth || 0;
            if (!width) return;
            const x = ev.clientX;
            setSelectionPopup(null);
            if (x < width * 0.3) {
              rendition.prev();
            } else if (x > width * 0.7) {
              rendition.next();
            } else {
              setShowToolbar(prev => !prev);
            }
          });

          // iOS Safari 兼容：mouseup 触发文本选择
          doc.addEventListener('mouseup', () => {
            const win = doc.defaultView || doc.ownerDocument?.defaultView;
            const sel = win?.getSelection?.()?.toString?.();
            if (sel && sel.trim().length > 0) {
              setTimeout(() => {
                const range = win?.getSelection()?.getRangeAt(0);
                if (range) {
                  const cfiRange = rendition.cfis?.fromRange(range);
                  if (cfiRange) rendition.emit('selected', cfiRange, sel);
                }
              }, 100);
            }
          });
        };

        rendition.on('rendered', () => {
          try {
            const contents = rendition.getContents?.() ?? [];
            contents.forEach((c: any) => bindPageEvents(c?.document));
          } catch (e) {
            console.warn('[Reader] Failed to bind page events:', e);
          }
        });

        // 监听文本选择
        rendition.on('selected', (cfiRange: string, contents: any) => {
          if (destroyed) return;
          
          console.log('[Reader] Selected event:', { cfiRange });
          
          // 从 range 中获取文本
          let text = '';
          const range = rendition.getRange(cfiRange);
          if (range) {
            text = range.toString();
            console.log('[Reader] Text from range:', text);
          }
          
          const trimmed = text.trim();
          if (!trimmed) return;

          const rect = range.getBoundingClientRect();
          const viewerRect = container.getBoundingClientRect();
          // 单个英文单词（可含连字符/撇号）才显示「查词」按钮
          const isSingleWord = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(trimmed);
          setSelectionPopup({
            y: rect.bottom - viewerRect.top + 8,
            text: trimmed,
            cfiRange,
            isSingleWord,
          });
        });

        // 监听高亮点击（使用最新 store 快照，避免闭包拿到初始 highlights）
        rendition.on('markClicked', (cfiRange: string, data: any) => {
          const hl = useAppStore.getState().highlights.find(h => h.cfiRange === cfiRange);
          if (hl) {
            setNoteDialog({
              highlightId: hl.id,
              text: hl.text,
              existingNote: hl.note,
            });
          }
        });

        // 恢复已有高亮（用当前 store 里的最新数据，annotation 会在各小节渲染时自动注入）
        useAppStore.getState().highlights
          .filter(hl => hl.bookId === bookId)
          .forEach(hl => {
            try {
              rendition.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles(hl.color));
            } catch (err) {
              console.warn('[Reader] Failed to restore highlight:', err);
            }
          });

        // 显示内容
        console.log('[Reader] Displaying content...');
        try {
          const target = useAppStore.getState().navigateTarget;
          if (target && target.bookId === bookId) {
            await rendition.display(target.cfiRange);
            useAppStore.getState().setNavigateTarget(null);
          } else if (book?.currentLocation) {
            await rendition.display(book.currentLocation);
          } else {
            await rendition.display();
          }
          console.log('[Reader] Display completed successfully');
        } catch (displayErr) {
          console.error('[Reader] Display failed:', displayErr);
          // 尝试从第一页开始
          try {
            await rendition.display(1);
            console.log('[Reader] Display from page 1 succeeded');
          } catch (retryErr) {
            console.error('[Reader] Retry display failed:', retryErr);
          }
        }

        // 检查渲染结果
        setTimeout(() => {
          const iframes = container.querySelectorAll('iframe');
          console.log('[Reader] Iframes created:', iframes.length);
          if (iframes.length > 0) {
            const iframe = iframes[0];
            console.log('[Reader] Iframe size:', iframe.offsetWidth, 'x', iframe.offsetHeight);
            console.log('[Reader] Iframe src:', iframe.src);
            
            // 检查 iframe 内容
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                console.log('[Reader] Iframe body length:', iframeDoc.body?.innerHTML?.length || 0);
                console.log('[Reader] Iframe body preview:', iframeDoc.body?.innerHTML?.substring(0, 200));
              } else {
                console.log('[Reader] Cannot access iframe content (cross-origin)');
              }
            } catch (e) {
              console.log('[Reader] Iframe content check failed:', e instanceof Error ? e.message : String(e));
            }
          } else {
            console.warn('[Reader] No iframes found!');
          }
        }, 1000);

        console.log('[Reader] Initialization complete');
        if (!destroyed) {
          setLoading(false);
        }
      } catch (err) {
        console.error('[Reader] Initialization failed:', err);
        if (!destroyed) {
          setLoading(false);
          alert(`加载书籍失败：${err instanceof Error ? err.message : '未知错误'}`);
        }
      }
    };

    initEpub();

    // 结算本次阅读时长（累加进统计并重置起点）
    const flushReadingTime = () => {
      const elapsed = (Date.now() - readingStartRef.current) / 1000;
      readingStartRef.current = Date.now();
      if (elapsed > 5 && bookId) {
        addReadingTime(bookId, elapsed);
      }
    };

    // 切后台 / 锁屏 / 切标签页时及时落账，避免本次时长丢失
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushReadingTime();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      destroyed = true;
      flushReadingTime();
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      // 清理
      if (renditionRef.current) {
        try { renditionRef.current.destroy(); } catch {}
      }
      if (bookRef.current) {
        try { bookRef.current.destroy(); } catch {}
      }
    };
  }, [bookId]);

  // Apply theme to rendition
  const applyTheme = useCallback((rendition: any) => {
    if (!rendition) return;
    const theme = themeMap[settings.theme];
    const isDark = settings.theme === 'dark';
    const fontStack = `${settings.fontFamily}, "Noto Serif SC", serif`;

    rendition.themes.register('custom', {
      'body': {
        'background': theme.bg + ' !important',
        'color': theme.text + ' !important',
        'font-family': fontStack + ' !important',
        'font-size': `${settings.fontSize}px !important`,
        'line-height': `${settings.lineHeight} !important`,
        'padding': '20px !important',
        'margin': '0 !important',
      },
      // 所有元素继承 body 的字号/行高/字体，确保字号调节真正生效
      '*': {
        'font-family': fontStack + ' !important',
        'font-size': 'inherit !important',
        'line-height': 'inherit !important',
      },
      'a': {
        'color': (isDark ? '#66aaff' : '#007AFF') + ' !important',
      },
    });
    rendition.themes.select('custom');
  }, [settings]);

  // Re-apply theme when settings change
  useEffect(() => {
    if (renditionRef.current) {
      applyTheme(renditionRef.current);
    }
  }, [settings, applyTheme]);

  // 翻页/滚动模式切换
  useEffect(() => {
    if (prevPageModeRef.current === settings.pageMode) return;
    prevPageModeRef.current = settings.pageMode;
    const rendition = renditionRef.current;
    if (rendition) {
      rendition.flow(settings.pageMode === 'scrolled' ? 'scrolled' : 'paginated');
      // 重新渲染到当前阅读位置
      const loc = book?.currentLocation;
      rendition.display(loc || undefined).catch(() => rendition.display());
    }
  }, [settings.pageMode]);

  // Navigate prev/next
  const goPrev = () => renditionRef.current?.prev();
  const goNext = () => renditionRef.current?.next();

  // Navigate to TOC item
  const goToChapter = (href: string) => {
    renditionRef.current?.display(href);
    setTocOpen(false);
  };

  // Toggle bookmark
  const toggleBookmark = () => {
    if (!book || !book.currentLocation) return;
    const existing = bookmarks.find(b => b.cfi === book.currentLocation);
    if (existing) {
      removeBookmark(existing.id);
    } else {
      addBookmark({
        id: generateId(),
        bookId: book.id,
        chapterHref: book.currentChapterHref,
        cfi: book.currentLocation,
        chapterTitle: currentChapterTitle,
        createdAt: Date.now(),
      });
    }
  };

  // Handle copy
  const handleCopy = async () => {
    if (!selectionPopup) return;
    const text = typeof selectionPopup.text === 'string' 
      ? selectionPopup.text 
      : String(selectionPopup.text || '');
    
    const ok = await copyTextToClipboard(text);
    if (ok) {
      console.log('[Reader] Text copied to clipboard');
    } else {
      console.error('[Reader] Failed to copy text');
    }
    setSelectionPopup(null);
  };

  // Handle highlight
  const handleHighlight = () => {
    if (!selectionPopup || !bookId) return;
    
    // 确保 text 是字符串
    const text = typeof selectionPopup.text === 'string' 
      ? selectionPopup.text 
      : String(selectionPopup.text || '');
    
    const hl: Highlight = {
      id: generateId(),
      bookId,
      chapterHref: book?.currentChapterHref || '',
      cfiRange: selectionPopup.cfiRange,
      text,
      color: settings.highlightColor,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addHighlight(hl);
    renditionRef.current?.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles(hl.color));
    setSelectionPopup(null);
  };

  // Handle add note
  const handleAddNote = () => {
    if (!selectionPopup || !bookId) return;
    
    // 确保 text 是字符串
    const text = typeof selectionPopup.text === 'string' 
      ? selectionPopup.text 
      : String(selectionPopup.text || '');
    
    const hl: Highlight = {
      id: generateId(),
      bookId,
      chapterHref: book?.currentChapterHref || '',
      cfiRange: selectionPopup.cfiRange,
      text,
      color: settings.highlightColor,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addHighlight(hl);
    renditionRef.current?.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles(hl.color));
    setSelectionPopup(null);
    setNoteDialog({ highlightId: hl.id, text: hl.text });
  };

  // Handle lookup（查词：记录生词 + 打开系统词典）
  const handleLookup = () => {
    if (!selectionPopup) return;
    const text = typeof selectionPopup.text === 'string' 
      ? selectionPopup.text 
      : String(selectionPopup.text || '');
    
    // 提取第一个英文单词，自动记录到生词本
    const wordMatch = text.match(/[A-Za-z][A-Za-z'-]*/);
    const word = wordMatch ? wordMatch[0].toLowerCase() : '';
    if (word && word.length >= 2 && bookId) {
      const state = useAppStore.getState();
      const exists = state.vocabulary.some(v => v.bookId === bookId && v.word === word);
      if (!exists) {
        addWord({
          id: generateId(),
          bookId,
          chapterHref: book?.currentChapterHref || '',
          chapterTitle: currentChapterTitle,
          word,
          context: text,
          createdAt: Date.now(),
          reviewCount: 0,
        });
      }
    }
    
    // 检测是否是 iOS 设备
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    if (isIOS) {
      // iOS 设备：使用系统词典查询
      // 使用 dict:// URL scheme 调用系统词典
      const dictUrl = `dict://${encodeURIComponent(text)}`;
      window.location.href = dictUrl;
    } else {
      // 非 iOS 设备：使用 Google Translate
      const translateUrl = `https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodeURIComponent(text)}`;
      window.open(translateUrl, '_blank');
    }
    
    setSelectionPopup(null);
  };

  // Save note
  const handleSaveNote = (note: string) => {
    if (!noteDialog) return;
    updateHighlight(noteDialog.highlightId, { note, updatedAt: Date.now() });
    setNoteDialog(null);
  };

  // Export notes
  const handleExportNotes = () => {
    if (!book) return;
    exportNotes(book.id, book.title);
  };

  // Click area to turn pages / toggle toolbar
  const handleViewerClick = (e: React.MouseEvent) => {
    const rect = viewerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSelectionPopup(null);
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.3) {
      // 左侧 30%：上一页
      renditionRef.current?.prev();
    } else if (x > 0.7) {
      // 右侧 30%：下一页
      renditionRef.current?.next();
    } else {
      // 中间 40%：显示/隐藏工具栏
      setShowToolbar(prev => !prev);
    }
  };

  if (!book) {
    return (
      <div className="reader-page" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>书籍未找到</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>返回书架</button>
      </div>
    );
  }

  return (
    <div className="reader-page">
      {/* Top toolbar */}
      <div className={`reader-toolbar reader-toolbar-top ${!showToolbar ? 'toolbar-hidden-top' : ''}`}>
        <button className="toolbar-btn" onClick={() => navigate('/')}>
          <CloseIcon />
        </button>
        <div className="chapter-title-bar">{currentChapterTitle || book.title}</div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button className="toolbar-btn" onClick={() => setBookmarkListOpen(true)} title="书签列表">
            <BookmarkIcon />
          </button>
          <button className="toolbar-btn" onClick={() => setNotesOpen(true)} title="想法">
            <NoteIcon />
          </button>
          <button className="toolbar-btn" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon />
          </button>
        </div>
      </div>

      {/* Viewer container - needs explicit dimensions for epub.js */}
      <div
        ref={viewerRef}
        id="epub-viewer-container"
        className="reader-viewer"
        onClick={handleViewerClick}
      />

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: '60px',
          bottom: '60px',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'var(--bg)',
          zIndex: 50,
        }}>
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        </div>
      )}

      {/* Bottom toolbar */}
      <div className={`reader-toolbar reader-toolbar-bottom ${!showToolbar ? 'toolbar-hidden-bottom' : ''}`}>
        <button className="toolbar-btn" onClick={() => setTocOpen(true)}>
          <ListIcon />
        </button>
        <button className="nav-btn" onClick={goPrev}>
          <ChevronLeftIcon />
        </button>
        <span className="progress-text">
          {currentSpineIndex + 1} / {totalSpineItems}
        </span>
        <button className="nav-btn" onClick={goNext}>
          <ChevronRightIcon />
        </button>
        <button className="toolbar-btn" onClick={toggleBookmark}>
          {bookmarks.some(b => b.cfi === book.currentLocation)
            ? <BookmarkFilledIcon />
            : <BookmarkIcon />
          }
        </button>
      </div>

      {/* Selection popup */}
      {selectionPopup && (
        <TextSelectionPopup
          y={selectionPopup.y}
          text={selectionPopup.text}
          isSingleWord={selectionPopup.isSingleWord}
          highlightColor={settings.highlightColor}
          onColorChange={(color) => updateSettings({ highlightColor: color })}
          onCopy={handleCopy}
          onHighlight={handleHighlight}
          onNote={handleAddNote}
          onLookup={handleLookup}
          onClose={() => setSelectionPopup(null)}
        />
      )}

      {/* Note dialog */}
      {noteDialog && (
        <div className="modal-overlay" onClick={() => setNoteDialog(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>批注</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, fontStyle: 'italic' }}>
              "{noteDialog.text}"
            </p>
            <NoteEditor
              initial={noteDialog.existingNote || ''}
              onSave={handleSaveNote}
              onCancel={() => setNoteDialog(null)}
            />
          </div>
        </div>
      )}

      {/* Side panels */}
      <TOCPanel
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        toc={toc}
        currentHref={book.currentChapterHref}
        onNavigate={goToChapter}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <BookmarkList
        open={bookmarkListOpen}
        onClose={() => setBookmarkListOpen(false)}
        bookmarks={bookmarks}
        onNavigate={(cfi) => {
          renditionRef.current?.display(cfi);
          setBookmarkListOpen(false);
        }}
        onDelete={removeBookmark}
      />

      <NotesPanel
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        notes={notes}
        onNavigate={(cfiRange) => {
          renditionRef.current?.display(cfiRange);
          setNotesOpen(false);
        }}
        onDelete={removeHighlight}
        onExport={handleExportNotes}
      />
    </div>
  );
}

// Note editor sub-component
function NoteEditor({ initial, onSave, onCancel }: {
  initial: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="写下你的批注..."
        autoFocus
      />
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => onSave(text)}>保存</button>
      </div>
    </>
  );
}
