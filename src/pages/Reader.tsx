import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ePub from 'epubjs';
import { useAppStore, themeMap } from '../stores';
import { getEpubFile } from '../services/db';
import { generateId, copyTextToClipboard } from '../utils';
import {
  ChevronLeftIcon, ChevronRightIcon, CloseIcon, MoreIcon,
  ListIcon, SettingsIcon, BookmarkIcon, BookmarkFilledIcon,
  NoteIcon,
} from '../components/Icons';
import SettingsPanel from '../components/SettingsPanel';
import TOCPanel from '../components/TOCPanel';
import NotesPanel from '../components/NotesPanel';
import TextSelectionPopup from '../components/HighlightPopup';
import { exportHighlightsAsText } from '../services/backup';
import type { Chapter, Highlight } from '../types';

// 划线统一为「背景色高亮」；深色主题下自动切换成柔和的暗蓝，避免刺眼
const MARK_COLOR = '#B3D9FF';
const MARK_COLOR_DARK = 'rgba(96, 140, 190, 0.45)';

function isDarkTheme(): boolean {
  return useAppStore.getState().settings.theme === 'dark';
}

function highlightStyles() {
  return {
    'background-color': isDarkTheme() ? MARK_COLOR_DARK : MARK_COLOR,
    'background-image': 'none',
    'border-radius': '2px',
    'padding': '0 2px',
  };
}

// 想法统一为「下划线」标记（区别于划线的背景高亮）
const NOTE_COLOR = '#5B8DEF';
const NOTE_COLOR_DARK = '#6B9FE8';

function noteStyles() {
  return {
    stroke: isDarkTheme() ? NOTE_COLOR_DARK : NOTE_COLOR,
    'stroke-opacity': 0.85,
    'stroke-width': 2,
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
  const updateSettings = useAppStore(s => s.updateSettings);
  const addReadingTime = useAppStore(s => s.addReadingTime);
  const highlights = useAppStore(s => s.highlights.filter(h => h.bookId === bookId));
  const addHighlight = useAppStore(s => s.addHighlight);
  const removeHighlight = useAppStore(s => s.removeHighlight);
  const updateHighlight = useAppStore(s => s.updateHighlight);
  const bookmarks = useAppStore(s => s.bookmarks.filter(b => b.bookId === bookId));
  const addBookmark = useAppStore(s => s.addBookmark);
  const removeBookmark = useAppStore(s => s.removeBookmark);
  // 当前阅读页是否已加书签
  const isCurrentBookmarked = !!(book?.currentLocation && bookmarks.some(b => b.cfi === book.currentLocation));
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
  const [totalPages, setTotalPages] = useState(0); // 全书屏幕页码总数
  const [currentPage, setCurrentPage] = useState(0); // 当前屏幕页码（1-based）
  const [progressPercent, setProgressPercent] = useState(0); // 进度百分比 0-100
  const [generatingPages, setGeneratingPages] = useState(false);
  const [chapterPage, setChapterPage] = useState(0); // 当前章节内页码
  const [chapterTotalPages, setChapterTotalPages] = useState(0); // 当前章节总页数
  const [tocPageMap, setTocPageMap] = useState<Record<string, number>>({}); // 目录项 href -> 起始页码
  const [bookmarkPageMap, setBookmarkPageMap] = useState<Record<string, number>>({}); // 书签 id -> 页码
  const [selectionPopup, setSelectionPopup] = useState<{
    y: number; text: string; cfiRange: string; isSingleWord: boolean;
  } | null>(null);
  const [noteDialog, setNoteDialog] = useState<{
    highlightId: string; text: string; existingNote?: string;
  } | null>(null);
  const [atEnd, setAtEnd] = useState(false); // 是否在全书最后一页
  const [finishedOpen, setFinishedOpen] = useState(false); // 读完完成页
  const [moreMenuOpen, setMoreMenuOpen] = useState(false); // 右上角更多菜单
  const [pullHint, setPullHint] = useState(false); // 下拉添加书签的提示

  const noteDialogLockRef = useRef(false); // 批注弹窗打开后短暂锁定遮罩，防止 iOS tap 的后续 click 立刻关掉它
  const noteDialogLockTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const atEndRef = useRef(false); // 是否在全书最后一页
  const finishedRef = useRef(false); // 是否已读完（防止进度被后续保存覆盖）
  const applyPagePaddingRef = useRef<((doc: any) => void) | null>(null); // 设置正文边距（供 applyTheme 调用）
  const layoutKeyRef = useRef(''); // 上一次的排版参数（用于判断是否真的需要重排）
  const layoutSettleTimerRef = useRef<ReturnType<typeof setTimeout>>(); // 重排防抖定时器
  const scrollTargetRef = useRef<string | undefined>(); // 跨页选择切换滑动模式时的定位 CFI
  const moreMenuOpenRef = useRef(false); // 更多菜单是否打开（供 iframe 内点击判断）
  const toggleBookmarkRef = useRef<(() => void) | null>(null); // 供 iframe 下拉手势调用
  const lastSelectionActivityRef = useRef(0); // 最近一次选区活动时间（供 touchend 判断不翻页）
  const savedSelectionRef = useRef<{ range: Range; doc: any; text: string } | null>(null); // 选区快照（供整段按钮）
  const selectionPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null); // 选择稳定轮询
  const readingStartRef = useRef(Date.now());
  const locationSaveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevPageModeRef = useRef(settings.pageMode);
  const pageTurnLockRef = useRef(0);
  const generatePagesRef = useRef<(() => void) | null>(null);
  const pageScrollLeftRef = useRef(0);
  const pageCharCountsRef = useRef<number[]>([]); // 各章节字符数
  const pageCharsPerPageRef = useRef(1500); // 每页字符数（随字号）

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

        // 创建 book 实例（epubjs 已静态导入，避免 standalone 模式动态 chunk 加载失败）
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

        // 英文书首次打开时，应用更适合英文阅读的默认排版
        try {
          const meta = (bookInstance as any).package?.metadata;
          const lang = String(meta?.language || '').toLowerCase();
          const isEnglish = lang.startsWith('en');
          const isFirstOpen = !book?.currentLocation || (book?.progress ?? 0) === 0;
          if (isEnglish && isFirstOpen) {
            updateSettings({ fontSize: 20, lineHeight: 1.6, pageMargin: 32, theme: 'green' });
          }
        } catch (e) {
          console.warn('[Reader] Apply English defaults failed:', e);
        }

        // 获取目录
        let tocItems: Chapter[] = [];
        try {
          const nav = await Promise.race([
            bookInstance.loaded.navigation,
            new Promise<any>((resolve) => setTimeout(() => resolve({ toc: [] }), 8000)),
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
          if (tocItems.length > 0) {
            console.log('[Reader] First TOC item:', JSON.stringify(tocItems[0]));
          }
        } catch (err) {
          console.warn('[Reader] Failed to load TOC:', err);
        }

        console.log('[Reader] Creating rendition...');
        // 用窗口尺寸作为基准（避免容器 clientWidth 在布局未完成时返回错误值导致分页每页内容过少）
        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight; // 阅读区全屏
        console.log('[Reader] Rendition size:', containerWidth, 'x', containerHeight);
        
        const rendition = bookInstance.renderTo(container, {
          width: containerWidth,
          height: containerHeight,
          flow: settings.pageMode === 'scrolled' ? 'scrolled' : 'paginated',
          spread: 'none',
          allowScriptedContent: true,
          // 关键：epub.js 分页时左右内边距 = gap / 2（layout.calculate → columns 里写死），
          // 所以要让书页边距为 pageMargin，就得把 gap 设为 pageMargin * 2。
          gap: (settings.pageMargin ?? 32) * 2,
        });
        renditionRef.current = rendition;

        // 强制分页单页模式（避免书的 metadata 覆盖 spread/flow 导致分页异常）
        if (settings.pageMode !== 'scrolled') {
          try {
            rendition.flow('paginated');
            rendition.spread('none');
          } catch (e) {
            console.warn('[Reader] Failed to force paginated mode:', e);
          }
        }

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

          // 检测是否在全书最后一页
          const isAtEnd = location.atEnd === true;
          setAtEnd(isAtEnd);
          atEndRef.current = isAtEnd;

          if (cfi && bookId) {
            // 章节内页码（epub.js 直接提供，可靠，随字体刷新）
            const dispPage = location.start?.displayed?.page;
            const dispTotal = location.start?.displayed?.total;
            if (dispPage) setChapterPage(dispPage);
            if (dispTotal) setChapterTotalPages(dispTotal);

            // 计算全书页码与百分比（字符累计 + 章节内页）
            try {
              const idx = location.start?.index;
              const dispPage = location.start?.displayed?.page || 1;
              const counts = pageCharCountsRef.current;
              const cpp = pageCharsPerPageRef.current;
              if (idx !== undefined && counts.length > 0) {
                const cum = counts.slice(0, idx).reduce((a, b) => a + b, 0);
                const totalChars = counts.reduce((a, b) => a + b, 0);
                if (totalChars > 0) {
                  setCurrentPage(Math.max(1, Math.floor(cum / cpp) + dispPage));
                  setProgressPercent(Math.round((cum / totalChars) * 100));
                }
              }
            } catch (e) {
              // 忽略页码计算错误
            }

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
                // 已在全书最后一页 / 已读完 → 固定 100%
                progress: (finishedRef.current || atEndRef.current) ? 1 : Math.min(progress, 1),
                lastReadAt: Date.now(),
              });

              if (spinePos >= 0) setCurrentSpineIndex(spinePos);
            }, 500);
          }

          // 更新章节标题
          if (href) {
            const safeDecode = (s: string) => {
              try { return decodeURIComponent(s); } catch { return s; }
            };
            // 用 spine 的 href 匹配（spine 和 TOC 都引用同一文件，最可靠）
            const spineIndex = location.start?.index;
            const spineHref = bookInstance.spine?.items?.[spineIndex]?.href || href;

            const findTitle = (items: Chapter[]): string => {
              for (const item of items) {
                // 规范化：取文件名（去路径/锚点/查询），保留扩展名与 _split 后缀
                const norm = (h: string) => {
                  let s = (h || '').split('#')[0].split('?')[0];
                  s = s.split('/').pop() || s;
                  return s.trim();
                };
                const a = safeDecode(norm(item.href));
                const b = safeDecode(norm(spineHref));
                if (a && b && a === b) {
                  return item.label;
                }
                if (item.subitems) {
                  const found = findTitle(item.subitems);
                  if (found) return found;
                }
              }
              return '';
            };
            let title = findTitle(tocItems);

            // fallback：用 spine 索引匹配展平后的 TOC
            if (!title) {
              const flatten = (items: Chapter[]): Chapter[] => {
                const out: Chapter[] = [];
                for (const it of items) {
                  out.push(it);
                  if (it.subitems) out.push(...flatten(it.subitems));
                }
                return out;
              };
              const flatToc = flatten(tocItems);
              if (spineIndex !== undefined && flatToc[spineIndex]) {
                title = flatToc[spineIndex].label;
              }
            }

            // 如果仍失败，用文件名作为章节名
            let chapterName = title;
            if (!chapterName) {
              const match = href.match(/([^/]+?)(?:\.xhtml|\.html|\.htm)?(?:#.*)?$/i);
              chapterName = match ? match[1].replace(/_split_\d+$/, '') : '';
            }

            setCurrentChapterTitle(chapterName || '');
          }
        });

        // 绑定翻页与文本选择事件（用 rendered 事件，直接获取 view 的 document）
        const boundDocs = new WeakSet<any>();

        // 记录 epub.js 内部横向滚动偏移（分页翻页通过 stage.scrollLeft 实现）
        // scroll 事件不冒泡，用 capture 从祖先容器捕获
        let pageScrollLeft = 0;
        container.addEventListener('scroll', (ev) => {
          pageScrollLeft = (ev.target as HTMLElement)?.scrollLeft || 0;
          pageScrollLeftRef.current = pageScrollLeft;
        }, { capture: true, passive: true });

        const bindPageEvents = (doc: any, contents: any) => {
          if (!doc || boundDocs.has(doc)) return;
          boundDocs.add(doc);

          const win = doc.defaultView || doc.ownerDocument?.defaultView;
          const isTouchDevice = 'ontouchstart' in window;

          const handleTap = (clientX: number) => {
            // 关键修复：touch.clientX 相对 iframe viewport（iframe 宽 = 多列总宽），
            // 翻页后 stage.scrollLeft 变化导致 clientX 偏移。减去 scrollLeft 得到相对当前屏的坐标。
            const screenX = clientX - pageScrollLeft;
            const width = window.innerWidth;
            if (!width) return;
            // 更多菜单打开时，点阅读区先关闭菜单，不翻页（iframe 内的点击不会冒泡到外层 document）
            if (moreMenuOpenRef.current) {
              setMoreMenuOpen(false);
              return;
            }
            setSelectionPopup(null);
            // 翻页热区扩大（左右各 40%），方便左手单手操作
            if (screenX < width * 0.4) {
              rendition.prev();
            } else if (screenX > width * 0.6) {
              if (atEndRef.current) {
                // 已到最后一页，继续后翻 → 显示读完完成页
                finishedRef.current = true;
                setFinishedOpen(true);
                if (bookId) updateBook(bookId, { progress: 1, lastReadAt: Date.now() });
              } else {
                rendition.next();
              }
            } else {
              setShowToolbar(prev => !prev);
            }
          };

          // 下一页（含读完完成页逻辑）
          const doNextPage = () => {
            if (atEndRef.current) {
              finishedRef.current = true;
              setFinishedOpen(true);
              if (bookId) updateBook(bookId, { progress: 1, lastReadAt: Date.now() });
            } else {
              rendition.next();
            }
          };

          if (isTouchDevice) {
            let touchStartX = 0;
            let touchStartY = 0;
            let touchStartTime = 0;
            let pullTriggered = false;

            doc.addEventListener('touchstart', (ev: TouchEvent) => {
              const touch = ev.touches[0];
              touchStartX = touch.clientX;
              touchStartY = touch.clientY;
              touchStartTime = Date.now();
              pullTriggered = false;
            }, { passive: true });

            // 下拉添加书签（仅分页模式）：向下拖动超过阈值时提示，松手即切换书签
            doc.addEventListener('touchmove', (ev: TouchEvent) => {
              if (useAppStore.getState().settings.pageMode !== 'paginated') return;
              if (pullTriggered) return;
              const sel = win?.getSelection?.()?.toString?.();
              if (sel && sel.trim().length > 0) return; // 正在选文字，不触发
              const dy = ev.touches[0].clientY - touchStartY;
              if (dy > 60) {
                pullTriggered = true;
                setPullHint(true);
              }
            }, { passive: true });

            doc.addEventListener('touchend', (ev: TouchEvent) => {
              // 有选区，或最近 800ms 内有过选区活动 → 说明用户在选择，不翻页/不切工具栏
              // （iOS 上 touchend 时选区可能还没生成，所以还要看活动时间）
              const sel = win?.getSelection?.()?.toString?.();
              if (sel && sel.trim().length > 0) return;
              if (Date.now() - lastSelectionActivityRef.current < 800) return;

              const touch = ev.changedTouches[0];
              const dx = touch.clientX - touchStartX;
              const dy = touch.clientY - touchStartY;
              const absDx = Math.abs(dx);
              const absDy = Math.abs(dy);
              const elapsed = Date.now() - touchStartTime;

              // 下拉超过阈值 → 切换书签（仅分页模式）
              if (pullTriggered && dy > 80 && useAppStore.getState().settings.pageMode === 'paginated') {
                pullTriggered = false;
                setPullHint(false);
                toggleBookmarkRef.current?.();
                return;
              }
              setPullHint(false);

              // 轻划翻页：水平位移 >= 30px、垂直位移 < 60px，动作干脆（<= 600ms）
              if (absDx >= 30 && absDy < 60 && elapsed <= 600) {
                setSelectionPopup(null);
                if (dx < 0) doNextPage();       // 左滑 → 下一页
                else rendition.prev();           // 右滑 → 上一页
                return;
              }
              // 点击翻页
              if (absDx < 10 && absDy < 10) {
                handleTap(touch.clientX);
              }
            }, { passive: true });
          } else {
            doc.addEventListener('click', (ev: MouseEvent) => {
              const sel = win?.getSelection?.()?.toString?.();
              if (sel && sel.trim().length > 0) return;
              handleTap(ev.clientX);
            });
          }

          // ===== 文本选择状态机 =====
          // IDLE(无选区) → SELECTING(内容在变) → STABLE(稳定 700ms) → SHOWN(工具条已显示)
          // 不依赖 touchstart/touchend：iOS 拖手柄时这些事件根本不触发，
          // 只有选区内容本身是否在变，才是"用户还在调整"的最可靠信号。
          let selState: 'IDLE' | 'SELECTING' | 'STABLE' | 'SHOWN' = 'IDLE';
          let stableSince = 0;
          let lastText = '';
          let lastEmittedText = '';

          const checkSelection = () => {
            try {
              const sel = win?.getSelection?.();
              if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
                selState = 'IDLE';
                lastText = '';
                stableSince = 0;
                lastEmittedText = '';
                return;
              }
              const text = sel.toString();
              if (!text || text.trim().length === 0) {
                selState = 'IDLE';
                lastText = '';
                stableSince = 0;
                return;
              }

              // 有非空选区：记录活动时间（供 touchend 判断"别翻页"）
              lastSelectionActivityRef.current = Date.now();

              if (text !== lastText) {
                // 选区内容变了 → 用户还在拖手柄调整
                lastText = text;
                stableSince = Date.now();
                selState = 'SELECTING';
                // 收起已弹出的工具条，避免挡手柄
                if (lastEmittedText) {
                  lastEmittedText = '';
                  setSelectionPopup(null);
                }
                return;
              }

              if (stableSince === 0) {
                stableSince = Date.now();
                return;
              }

              // 稳定判定：700ms 内容不变才视为"选择结束"
              if (selState === 'SELECTING') {
                if (Date.now() - stableSince < 700) return;
                selState = 'STABLE';
              }

              if (selState === 'STABLE' && text !== lastEmittedText) {
                lastEmittedText = text;
                // 保存选区快照，供「整段」按钮使用（不依赖实时 selection）
                try {
                  const liveRange = sel.getRangeAt(0);
                  savedSelectionRef.current = {
                    range: liveRange.cloneRange(),
                    doc,
                    text,
                  };
                } catch {
                  savedSelectionRef.current = null;
                }
                const range = sel.getRangeAt(0);
                const cfiRange = rendition.cfis?.fromRange(range);
                if (cfiRange) {
                  selState = 'SHOWN';
                  rendition.emit('selected', cfiRange, text);
                }
              }
            } catch {}
          };

          // 每个 document 启动一个轮询（绑定前先清掉旧的）
          if (selectionPollTimerRef.current) clearInterval(selectionPollTimerRef.current);
          selectionPollTimerRef.current = setInterval(checkSelection, 120);
        };

        // 直接对正文 body 设内联边距（内联 !important 优先级最高，确保边距真正生效）
        const applyPagePadding = (doc: any) => {
          try {
            const body = doc?.body;
            if (!body) return;
            const m = settings.pageMargin ?? 32;
            body.style.setProperty('padding', `32px ${m}px 40px ${m}px`, 'important');
            body.style.setProperty('margin', '0', 'important');
          } catch (e) {
            console.warn('[Reader] applyPagePadding failed:', e);
          }
        };
        applyPagePaddingRef.current = applyPagePadding;

        rendition.on('rendered', (section: any, view: any) => {
          if (destroyed) return;
          try {
            const doc = view?.contents?.document;
            if (doc) {
              bindPageEvents(doc, view.contents);
              applyPagePadding(doc);
            }
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
          // 同一位置可能同时有「划线」和「想法」两条，优先匹配带想法的
          const candidates = useAppStore.getState().highlights.filter(h => h.cfiRange === cfiRange);
          const hl = candidates.find(h => h.note && h.note.trim().length > 0) || candidates[0];
          if (hl) {
            // 锁定遮罩 800ms，防止 iOS tap 的后续 click 立刻关掉弹窗
            noteDialogLockRef.current = true;
            if (noteDialogLockTimerRef.current) clearTimeout(noteDialogLockTimerRef.current);
            noteDialogLockTimerRef.current = setTimeout(() => {
              noteDialogLockRef.current = false;
            }, 800);
            setNoteDialog({
              highlightId: hl.id,
              text: hl.text,
              existingNote: hl.note,
            });
          }
        });

        // 恢复已有划线/想法（划线用背景高亮，想法用蓝色下划线）
        useAppStore.getState().highlights
          .filter(hl => hl.bookId === bookId)
          .forEach(hl => {
            try {
              if (hl.note && hl.note.trim().length > 0) {
                rendition.annotations.add('underline', hl.cfiRange, {}, undefined, undefined, noteStyles());
              } else {
                rendition.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles());
              }
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
          
          // 延迟重新分页，确保用正确的视口尺寸（解决"翻几页内容才变一下"的分页过细问题）
          setTimeout(() => {
            try {
              rendition.resize(window.innerWidth, window.innerHeight);
              console.log('[Reader] Resized to', window.innerWidth, 'x', window.innerHeight);
            } catch (e) {
              console.warn('[Reader] Resize failed:', e);
            }
          }, 200);

          // 定义页码生成函数（供字体调整时复用）
          // 用手动遍历 spine 统计字符数的方式估算全书页码，避免 locations.generate 超时卡死
          const generateLocations = () => {
            if (destroyed) return;
            setGeneratingPages(true);
            const doCompute = async () => {
              const spine = bookInstance.spine?.items || [];
              const charsPerPage = Math.max(500, Math.round(1500 * 16 / settings.fontSize));
              pageCharsPerPageRef.current = charsPerPage;
              const charCounts: number[] = [];
              let totalChars = 0;
              for (let i = 0; i < spine.length; i++) {
                const section = spine[i];
                if (!section.linear) { charCounts.push(0); continue; }
                let text = '';
                try {
                  const doc = await Promise.race([
                    bookInstance.load(section.href),
                    new Promise<any>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
                  ]);
                  text = doc?.documentElement?.textContent || doc?.body?.textContent || (typeof doc === 'string' ? doc : '');
                } catch (e) {
                  text = '';
                }
                const len = text.length;
                charCounts.push(len);
                totalChars += len;
                if (destroyed) return;
              }
              pageCharCountsRef.current = charCounts;
              const total = Math.max(1, Math.ceil(totalChars / charsPerPage));

              // 为目录项计算起始页码：累计到该章节之前的字符数
              const map: Record<string, number> = {};
              let cum = 0;
              const cumByHref: Record<string, number> = {};
              for (let i = 0; i < spine.length; i++) {
                const section = spine[i];
                if (section.linear) {
                  cumByHref[section.href] = cum;
                  cum += charCounts[i] || 0;
                }
              }
              // 规范化 href：去锚点/查询/路径，只留文件名，便于 TOC 与 spine 匹配
              const normHref = (h: string) => {
                let s = (h || '').split('#')[0].split('?')[0];
                s = s.split('/').pop() || s;
                return s.trim().toLowerCase();
              };
              const linearSections = spine.filter((s: any) => s.linear);
              let tocCounter = 0;
              const walkToc = (items: Chapter[]) => {
                for (const item of items) {
                  const itemNorm = normHref(item.href);
                  let section = spine.find((s: any) => normHref(s.href) === itemNorm);
                  // fallback：按顺序对应 linear section（TOC 顺序通常与 spine 一致）
                  if (!section && linearSections[tocCounter]) {
                    section = linearSections[tocCounter];
                  }
                  if (section && cumByHref[section.href] !== undefined) {
                    map[item.href] = Math.floor(cumByHref[section.href] / charsPerPage) + 1;
                  }
                  tocCounter++;
                  if (item.subitems) walkToc(item.subitems);
                }
              };
              walkToc(tocItems);
              console.log('[Reader] toc page map size:', Object.keys(map).length, 'of', tocCounter);

              // 书签页码：按书签所在章节累计字符估算
              const bmMap: Record<string, number> = {};
              try {
                useAppStore.getState().bookmarks
                  .filter(b => b.bookId === bookId)
                  .forEach(b => {
                    const section = spine.find((s: any) => normHref(s.href) === normHref(b.chapterHref));
                    if (section && cumByHref[section.href] !== undefined) {
                      bmMap[b.id] = Math.floor(cumByHref[section.href] / charsPerPage) + 1;
                    }
                  });
              } catch (e) {
                console.warn('[Reader] bookmark page calc failed:', e);
              }

              console.log('[Reader] computed total pages:', total, 'chars:', totalChars);
              if (!destroyed) {
                setTotalPages(total);
                setTocPageMap(map);
                setBookmarkPageMap(bmMap);
                setGeneratingPages(false);
              }
            };
            doCompute();
          };
          generatePagesRef.current = generateLocations;

          // 延迟生成全书页码（等 resize 完成后）
          setTimeout(() => generateLocations(), 600);
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
      // 清除选择稳定轮询
      if (selectionPollTimerRef.current) {
        clearInterval(selectionPollTimerRef.current);
        selectionPollTimerRef.current = null;
      }

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
        'padding': `32px ${settings.pageMargin ?? 32}px 40px ${settings.pageMargin ?? 32}px !important`,
        'margin': '0 auto !important',
      },
      // 所有元素继承 body 的字号/行高/字体，确保字号调节真正生效
      '*': {
        'font-family': fontStack + ' !important',
        'font-size': 'inherit !important',
        'line-height': 'inherit !important',
        // 允许长按选中文字（注意：iOS 上 callout:none 会连文本选择一起禁用，所以必须保持 default）
        '-webkit-touch-callout': 'default !important',
        '-webkit-user-select': 'text !important',
        'user-select': 'text !important',
        // 防止长按/拖动时触发图片或链接的原生拖拽，干扰选区
        '-webkit-user-drag': 'none !important',
        // 滑动模式显式允许纵向滚动（避免手势被当成拖拽），分页模式保持 auto 不影响翻页
        'touch-action': settings.pageMode === 'scrolled' ? 'pan-y !important' : 'auto !important',
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

    // 已渲染的正文也立即套用新边距（内联样式，高于电子书自身 CSS）
    try {
      const contents = rendition.getContents?.() || [];
      contents.forEach((c: any) => {
        applyPagePaddingRef.current?.(c?.document);
      });
    } catch (e) {
      console.warn('[Reader] Re-apply padding failed:', e);
    }
  }, [settings]);

  // Re-apply theme when settings change
  useEffect(() => {
    if (!renditionRef.current) return;
    applyTheme(renditionRef.current);

    // 只有影响排版的设置才需要重排（字号/行高/页边距/字体），
    // 且用防抖：拖动滑块时只在停止约 400ms 后重排一次，避免连续重排造成卡顿。
    const layoutKey = `${settings.fontSize}|${settings.lineHeight}|${settings.fontFamily}|${settings.pageMargin}`;
    if (layoutKeyRef.current === layoutKey) return;
    layoutKeyRef.current = layoutKey;

    if (layoutSettleTimerRef.current) clearTimeout(layoutSettleTimerRef.current);
    layoutSettleTimerRef.current = setTimeout(() => {
      try {
        const r = renditionRef.current;
        if (!r) return;
        // 更新 epub.js 的 gap（左右内边距 = gap/2）
        if (r.manager?.settings) {
          r.manager.settings.gap = (settings.pageMargin ?? 32) * 2;
        }
        // 关键：epub.js 的 manager.resize 在尺寸不变时会直接 return（不重新布局），
        // 清空 _stageSize 强制它重新走 updateLayout，gap 改动才会生效。
        if (r.manager) {
          (r.manager as any)._stageSize = undefined;
        }
        r.resize(window.innerWidth, window.innerHeight);
      } catch (e) {
        console.warn('[Reader] Re-paginate after setting change failed:', e);
      }
      // 排版变化后重新生成页码
      generatePagesRef.current?.();
    }, 400);
  }, [settings, applyTheme]);

  // 翻页/滚动模式切换
  useEffect(() => {
    if (prevPageModeRef.current === settings.pageMode) return;
    prevPageModeRef.current = settings.pageMode;
    const rendition = renditionRef.current;
    if (rendition) {
      rendition.flow(settings.pageMode === 'scrolled' ? 'scrolled' : 'paginated');
      // 重新渲染到当前阅读位置
      // 优先用跨页选择记录的定位 CFI，避免切换后闪到别处
      const loc = scrollTargetRef.current || book?.currentLocation;
      scrollTargetRef.current = undefined;
      rendition.display(loc || undefined).catch(() => rendition.display());
    }
  }, [settings.pageMode]);

  // 跨页选择：正文里选到屏幕底部继续拖时，自动切到滑动模式（选择可跨多屏），
  // 并把阅读位置定位到选择起点，避免切换后闪到下一页
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { cfi?: string } | undefined;
      scrollTargetRef.current = detail?.cfi;
      if (useAppStore.getState().settings.pageMode === 'scrolled') return;
      updateSettings({ pageMode: 'scrolled' });
    };
    window.addEventListener('reader-switch-to-scroll', handler as EventListener);
    return () => window.removeEventListener('reader-switch-to-scroll', handler as EventListener);
  }, [updateSettings]);

  // 更多菜单：点击菜单外部（含阅读区 iframe 内）自动关闭
  useEffect(() => {
    moreMenuOpenRef.current = moreMenuOpen;
    if (!moreMenuOpen) return;
    const close = () => setMoreMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [moreMenuOpen]);

  // 选择工具条：点击工具条外部关闭（替代原来的全屏遮罩，避免遮罩挡住选择手柄）
  useEffect(() => {
    if (!selectionPopup) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement | null;
      // 点在工具条内 → 不关闭
      if (target?.closest?.('.text-selection-popup')) return;
      setSelectionPopup(null);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [selectionPopup]);

  // Navigate prev/next
  const goPrev = () => renditionRef.current?.prev();
  const goNext = () => {
    if (atEndRef.current) {
      finishedRef.current = true;
      setFinishedOpen(true);
      if (bookId) updateBook(bookId, { progress: 1, lastReadAt: Date.now() });
    } else {
      renditionRef.current?.next();
    }
  };

  // Navigate to TOC item
  const goToChapter = (href: string) => {
    // 规范化匹配 spine 的 href（TOC href 与 spine href 格式常不一致）
    const normHref = (h: string) => {
      let s = (h || '').split('#')[0].split('?')[0];
      s = s.split('/').pop() || s;
      return s.trim().toLowerCase();
    };
    const spine = bookRef.current?.spine?.items || [];
    const target = normHref(href);
    const section = spine.find((s: any) => normHref(s.href) === target);
    // 优先用 spine 的完整 href 跳转，其次用原始 href
    const finalTarget = section?.href || href;
    console.log('[Reader] goToChapter:', href, '->', finalTarget);
    renditionRef.current?.display(finalTarget);
    setTocOpen(false);
  };

  // 提取当前页第一句话（用于书签）
  const extractFirstLine = (): string => {
    try {
      const rendition = renditionRef.current;
      const loc = rendition?.currentLocation?.();
      const cfi = loc?.start?.cfi;
      if (!cfi) return '';
      const range = rendition.getRange(cfi);
      if (!range) return '';
      // 从 range 的 startContainer 向上找到段落元素
      let node: Node | null = range.startContainer;
      while (node && node.nodeType !== 1) node = node.parentNode;
      while (node && !['P', 'DIV', 'SECTION', 'BODY'].includes((node as Element).tagName)) {
        node = node.parentNode;
      }
      const text = (node as Element)?.textContent?.trim() || '';
      if (!text) return '';
      // 取第一句
      const match = text.match(/[^.!?。！？\n]*[.!?。！？]?/);
      const firstLine = (match ? match[0] : text).trim();
      return firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine;
    } catch {
      return '';
    }
  };

  // Toggle bookmark
  const toggleBookmark = () => {
    if (!book || !book.currentLocation) return;
    const existing = bookmarks.find(b => b.cfi === book.currentLocation);
    if (existing) {
      removeBookmark(existing.id);
    } else {
      // 章节名：优先 TOC 匹配结果，失败用文件名降级
      let chapterName = currentChapterTitle;
      if (!chapterName && book.currentChapterHref) {
        const match = book.currentChapterHref.match(/([^/]+?)(?:\.xhtml|\.html|\.htm)?(?:#.*)?$/i);
        chapterName = match ? match[1].replace(/_split_\d+$/, '') : '';
      }

      // 关键：把「目录项」的 href 存进书签，保证书签能挂到目录对应章节下
      const normHref = (h: string) => {
        let s = (h || '').split('#')[0].split('?')[0];
        s = s.split('/').pop() || s;
        return s.trim().toLowerCase();
      };
      const flatToc: Chapter[] = [];
      const flatten = (items: Chapter[]) => {
        for (const it of items) {
          flatToc.push(it);
          if (it.subitems) flatten(it.subitems);
        }
      };
      flatten(toc);
      const matchedToc = flatToc.find(it =>
        normHref(it.href) === normHref(book.currentChapterHref || '') ||
        normHref(it.href).includes(normHref(book.currentChapterHref || '')) ||
        normHref(book.currentChapterHref || '').includes(normHref(it.href))
      );
      const chapterHref = matchedToc?.href || book.currentChapterHref || '';
      if (!chapterName && matchedToc) chapterName = matchedToc.label;

      const firstLine = extractFirstLine();

      addBookmark({
        id: generateId(),
        bookId: book.id,
        chapterHref,
        cfi: book.currentLocation,
        chapterTitle: chapterName,
        firstLine,
        createdAt: Date.now(),
      });
    }
  };
  // 供 iframe 内下拉手势调用（避免 useEffect 闭包拿到旧引用）
  toggleBookmarkRef.current = toggleBookmark;

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

  // 选中整段（解决跨页选择：整段可跨页选中）
  // 优先使用「选区快照」——工具条弹出后实时 selection 可能已丢失，快照更可靠
  const handleSelectParagraph = () => {
    if (!selectionPopup) return;
    try {
      const rendition = renditionRef.current;
      const blockTags = ['P', 'DIV', 'LI', 'SECTION', 'BLOCKQUOTE', 'TD', 'H1', 'H2', 'H3', 'ARTICLE'];

      let range: Range | null = null;
      let doc: any = null;

      // 1) 优先用快照
      const saved = savedSelectionRef.current;
      if (saved?.range && saved?.doc) {
        range = saved.range;
        doc = saved.doc;
      }

      // 2) 快照不可用时，回退到遍历 iframe 内的实时选区
      if (!range || !doc) {
        const contents = rendition?.getContents?.() || [];
        for (const c of contents) {
          const d = c?.document;
          const w = d?.defaultView;
          if (!d || !w) continue;
          const s = w.getSelection?.();
          if (!s || s.isCollapsed || s.rangeCount === 0) continue;
          range = s.getRangeAt(0);
          doc = d;
          break;
        }
      }

      if (!range || !doc) return;

      // 向上找段落级元素
      let node: any = range.commonAncestorContainer;
      if (node?.nodeType === 3) node = node.parentNode;
      while (node && node !== doc.body && !blockTags.includes(node.nodeName)) {
        node = node.parentNode;
      }
      if (!node || node === doc.body) return;

      const paraRange = doc.createRange();
      paraRange.selectNodeContents(node);

      // 同步更新 iframe 内的可视选区
      const win = doc.defaultView;
      const liveSel = win?.getSelection?.();
      if (liveSel) {
        liveSel.removeAllRanges();
        liveSel.addRange(paraRange);
      }

      const cfiRange = rendition.cfis?.fromRange(paraRange);
      if (cfiRange) {
        const text = paraRange.toString();
        setSelectionPopup({ ...selectionPopup, cfiRange, text });
        // 更新快照，方便连续操作
        savedSelectionRef.current = { range: paraRange.cloneRange(), doc, text };
      }
    } catch (e) {
      console.warn('[Reader] select paragraph failed:', e);
    }
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
    // 写想法用「下划线」标记（蓝色），与「划线」的背景高亮区分，两者独立
    renditionRef.current?.annotations.add('underline', hl.cfiRange, {}, undefined, undefined, noteStyles());
    setSelectionPopup(null);
    setNoteDialog({ highlightId: hl.id, text: hl.text });
  };

  // 从 epub.js range 中提取包含选中词的完整句子作为例句
  function extractSentenceFromRange(rendition: any, cfiRange: string, word: string): string {
    try {
      const range = rendition.getRange(cfiRange);
      if (!range) return '';
      
      // 获取 range 所在的 document（可能在 iframe 内）
      const doc = range.startContainer?.ownerDocument || range.commonAncestorContainer?.ownerDocument;
      if (!doc) return '';
      
      // 从 range 的 startContainer 向上找到段落级别的元素（p, div, li 等）
      let node: Node | null = range.startContainer;
      while (node && node.nodeType !== 1) {
        node = node.parentNode;
      }
      
      // 继续向上找到段落元素
      while (node) {
        const tagName = (node as Element).tagName?.toLowerCase();
        if (tagName === 'p' || tagName === 'div' || tagName === 'li' || tagName === 'section' || tagName === 'body') {
          break;
        }
        node = node.parentNode;
      }
      
      if (!node) return '';
      
      const fullText = (node as Element).textContent || '';
      if (!fullText) return '';
      
      // 用正则提取包含该词的句子（以句号、问号、感叹号、换行为边界）
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`[^.!?\\n]*${escapedWord}[^.!?\\n]*[.!?]?`, 'i');
      const match = fullText.match(regex);
      
      if (match && match[0].trim().length > word.length) {
        return match[0].trim();
      }
      
      // 如果没匹配到完整句子，返回段落的前 300 字符
      return fullText.substring(0, 300).trim();
    } catch (e) {
      console.warn('[Reader] Failed to extract sentence:', e);
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
    
    // 查词：优先调起欧路词典；1.2 秒内页面没跳转（说明未安装欧路）则回退到在线词典
    const lookupWord = word || text;
    const fallbackUrl = isIOS
      ? `https://dict.youdao.com/result?word=${encodeURIComponent(lookupWord)}&lang=en`
      : `https://dict.youdao.com/search?q=${encodeURIComponent(lookupWord)}`;

    if (isIOS) {
      let jumped = false;
      const onHide = () => {
        jumped = true;
        document.removeEventListener('visibilitychange', onHide);
      };
      document.addEventListener('visibilitychange', onHide);
      setTimeout(() => {
        document.removeEventListener('visibilitychange', onHide);
        if (!jumped && !document.hidden) {
          window.open(fallbackUrl, '_blank');
        }
      }, 1200);
      window.location.href = `eudic://dict/${encodeURIComponent(lookupWord)}`;
    } else {
      window.open(fallbackUrl, '_blank');
    }
    
    setSelectionPopup(null);
  };

  // Save note
  const handleSaveNote = (note: string) => {
    if (!noteDialog) return;
    updateHighlight(noteDialog.highlightId, { note, updatedAt: Date.now() });
    setNoteDialog(null);
  };

  // 删除当前划线
  const handleDeleteHighlight = () => {
    if (!noteDialog) return;
    const hl = useAppStore.getState().highlights.find(h => h.id === noteDialog.highlightId);
    if (hl) {
      removeHighlight(hl.id);
      try {
        renditionRef.current?.annotations.remove(hl.cfiRange, 'highlight');
      } catch (e) {
        console.warn('[Reader] Remove annotation failed:', e);
      }
    }
    setNoteDialog(null);
  };

  // 导出划线/想法为 TXT（notesOnly 只导带想法的条目）
  const handleExportNotes = (notesOnly: boolean) => {
    if (!book) return;
    exportHighlightsAsText(highlights, [book], notesOnly);
  };

  // 工具栏页码：全书页码（generate 成功），失败 fallback 章节内页码
  const toolbarPage = totalPages > 0 ? currentPage : chapterPage;
  const toolbarTotal = totalPages > 0 ? totalPages : chapterTotalPages;

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
          <ChevronLeftIcon />
        </button>
        <div className="chapter-title-bar">{currentChapterTitle || book.title}</div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            className="toolbar-btn"
            onClick={(e) => { e.stopPropagation(); setMoreMenuOpen(prev => !prev); }}
            title="更多"
          >
            <MoreIcon />
          </button>
          {moreMenuOpen && (
            <div className="reader-more-menu" onClick={e => e.stopPropagation()}>
              <button className="reader-more-item" onClick={() => { setMoreMenuOpen(false); setSettingsOpen(true); }}>
                <SettingsIcon /> 阅读设置
              </button>
              <button className="reader-more-item" onClick={() => { setMoreMenuOpen(false); setNotesOpen(true); }}>
                <NoteIcon /> 想法
              </button>
            </div>
          )}
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

      {/* Bottom toolbar：目录按钮 | 进度(居中) | 页码(居右) */}
      <div className={`reader-toolbar reader-toolbar-bottom ${!showToolbar ? 'toolbar-hidden-bottom' : ''}`}>
        <button
          className={`toolbar-btn ${tocOpen ? 'toolbar-btn-active' : ''}`}
          onClick={() => setTocOpen(prev => !prev)}
        >
          <ListIcon />
        </button>
        <span className="progress-percent">{progressPercent}%</span>
        <span className="progress-text">
          {toolbarTotal > 0 ? `${toolbarPage} / ${toolbarTotal}` : (generatingPages ? '…' : '')}
        </span>
      </div>

      {/* 下拉添加书签的提示条（仅分页模式） */}
      {pullHint && (
        <div className="pull-bookmark-hint">↓ 松手添加书签</div>
      )}

      {/* 当前页有书签时的右上角标记（仅分页模式） */}
      {!showToolbar && isCurrentBookmarked && (
        <div className="bookmark-ribbon" onClick={toggleBookmark} title="取消书签">
          <BookmarkFilledIcon />
        </div>
      )}

      {/* 纯阅读模式右下角页码（章节内页码） */}
      {!showToolbar && !loading && chapterTotalPages > 0 && (
        <div className="reading-page-indicator">
          {chapterPage} / {chapterTotalPages}
        </div>
      )}

      {/* Selection popup：固定在屏幕底部，避开 iOS 原生选择菜单 */}
      {selectionPopup && (
        <TextSelectionPopup
          y={selectionPopup.y}
          text={selectionPopup.text}
          isSingleWord={selectionPopup.isSingleWord}
          onCopy={handleCopy}
          onHighlight={handleHighlight}
          onNote={handleAddNote}
          onLookup={handleLookup}
          onSelectParagraph={handleSelectParagraph}
          onClose={() => setSelectionPopup(null)}
        />
      )}

      {/* Note dialog */}
      {noteDialog && (
        <div
          className="modal-overlay"
          onClick={() => {
            // 锁定期间忽略（iOS tap 的 touchend 触发弹窗后，随后的 click 会落到遮罩上）
            if (noteDialogLockRef.current) return;
            setNoteDialog(null);
          }}
        >
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
            <button
              className="btn btn-danger"
              onClick={handleDeleteHighlight}
              style={{ width: '100%', marginTop: 8 }}
            >
              删除划线
            </button>
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
        tocPageMap={tocPageMap}
        bookmarkPageMap={bookmarkPageMap}
        isCurrentBookmarked={isCurrentBookmarked}
        onToggleBookmark={toggleBookmark}
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

      {/* 读完完成页 */}
      {finishedOpen && (
        <div className="modal-overlay" onClick={() => setFinishedOpen(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <h3>已读完</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '8px 0 20px' }}>
              《{book.title}》
            </p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setFinishedOpen(false)}>继续阅读</button>
              <button className="btn btn-primary" onClick={() => navigate('/')}>回到书架</button>
            </div>
          </div>
        </div>
      )}
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
