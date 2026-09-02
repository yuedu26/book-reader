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
import NotesPanel from '../components/NotesPanel';
import TextSelectionPopup from '../components/HighlightPopup';
import { exportHighlightsAsText } from '../services/backup';
import type { Chapter, Highlight } from '../types';

// 划线统一为「背景色高亮」，颜色固定为舒适蓝
const MARK_COLOR = '#B3D9FF';

function highlightStyles() {
  return {
    'background-color': MARK_COLOR,
    'background-image': 'none',
    'border-radius': '2px',
    'padding': '0 2px',
  };
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
  const pageTurnLockRef = useRef(0);

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

            // 用 iframe 内窗口的宽度（ev.clientX 是相对于 iframe 的坐标，必须用 iframe 的宽度）
            const width = win?.innerWidth || 0;
            if (!width) return;
            const x = ev.clientX;
            setSelectionPopup(null);

            if (x < width * 0.3) {
              if (Date.now() - pageTurnLockRef.current < 250) return;
              pageTurnLockRef.current = Date.now();
              rendition.prev();
            } else if (x > width * 0.7) {
              if (Date.now() - pageTurnLockRef.current < 250) return;
              pageTurnLockRef.current = Date.now();
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
              rendition.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles());
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
        // 允许长按选择文本（iOS Safari）
        '-webkit-touch-callout': 'default !important',
        '-webkit-user-select': 'text !important',
        'user-select': 'text !important',
      },
      'a': {
        'color': (isDark ? '#66aaff' : '#007AFF') + ' !important',
      },
      // 覆盖 marks-pane 的 SVG 样式，去掉下划线的边框
      'svg': {
        'pointer-events': 'none !important',
      },
      'svg path': {
        'stroke-linecap': 'round !important',
        'stroke-linejoin': 'round !important',
        'fill': 'none !important',
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
      color: MARK_COLOR,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addHighlight(hl);
    renditionRef.current?.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles());
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
      color: MARK_COLOR,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addHighlight(hl);
    renditionRef.current?.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles());
    setSelectionPopup(null);
    setNoteDialog({ highlightId: hl.id, text: hl.text });
  };

  // 从 epub.js range 中提取包含选中词的完整句子作为例句
  function extractSentenceFromRange(rendition: any, cfiRange: string, word: string): string {
    try {
      const range = rendition.getRange(cfiRange);
      if (!range) return '';
      
      // 从 range 的 startContainer 向上找到段落级别的元素（p, div, li 等）
      let node: Node | null = range.startContainer;
      while (node && node.nodeType !== 1) {
        node = node.parentNode;
      }
      
      // 继续向上找到段落元素
      while (node) {
        const tagName = (node as Element).tagName?.toLowerCase();
        if (tagName === 'p' || tagName === 'div' || tagName === 'li' || tagName === 'section') {
          break;
        }
        node = node.parentNode;
      }
      
      if (!node) return '';
      
      const fullText = (node as Element).textContent || '';
      if (!fullText) return '';
      
      // 用正则提取包含该词的句子（以句号、问号、感叹号为边界）
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`[^.!?]*${escapedWord}[^.!?]*[.!?]?`, 'i');
      const match = fullText.match(regex);
      
      if (match && match[0].trim().length > 0) {
        return match[0].trim();
      }
      
      // 如果没匹配到，返回段落的前 200 字符
      return fullText.substring(0, 200).trim();
    } catch {
      return '';
    }
  }

// Handle lookup（查词：记录生词 + 调起欧路词典离线查词）
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
        // 提取该词所在的完整句子作为例句
        const exampleSentence = extractSentenceFromRange(renditionRef.current, selectionPopup.cfiRange, word);
        
        addWord({
          id: generateId(),
          bookId,
          chapterHref: book?.currentChapterHref || '',
          chapterTitle: currentChapterTitle,
          word,
          context: exampleSentence || text,  // 优先用完整句子，否则用选中文本
          createdAt: Date.now(),
          reviewCount: 0,
        });
      }
    }
    
    // 检测是否是 iOS 设备
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    if (isIOS) {
      // iOS：调起欧路词典查词（用已导入的离线 mdx 词库，无需联网）
      const lookupWord = word || text;
      window.location.href = `eudic://dict/${encodeURIComponent(lookupWord)}`;
    } else {
      // 非 iOS：打开有道词典在线查词
      window.open(`https://dict.youdao.com/search?q=${encodeURIComponent(word || text)}`, '_blank');
    }
    
    setSelectionPopup(null);
  };

  // Save note
  const handleSaveNote = (note: string) => {
    if (!noteDialog) return;
    updateHighlight(noteDialog.highlightId, { note, updatedAt: Date.now() });
    setNoteDialog(null);
  };

  // 导出划线/想法为 TXT（notesOnly 只导带想法的条目）
  const handleExportNotes = (notesOnly: boolean) => {
    if (!book) return;
    exportHighlightsAsText(highlights, [book], notesOnly);
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
        bookmarks={bookmarks}
        onNavigateBookmark={(cfi) => {
          renditionRef.current?.display(cfi);
          setTocOpen(false);
        }}
        onDeleteBookmark={removeBookmark}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <NotesPanel
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        highlights={highlights}
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
