import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
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
    y: number;              // 选区底部（用于向下定位）
    rectTop: number;        // 选区顶部（用于向上定位，多行选择时更准）
    text: string;
    cfiRange: string;
    isSingleWord: boolean;
    // 点击已有标注时进入「标注操作」模式：划线按钮变删除、想法按钮变编辑想法
    mark?: { highlightId: string; hasNote: boolean };
  } | null>(null);
  const [noteDialog, setNoteDialog] = useState<{
    highlightId?: string;   // 有值 = 编辑已有标注；无值 = 新建（保存时才真正创建）
    text: string;
    cfiRange: string;       // 新建时用于创建标注
    existingNote?: string;
  } | null>(null);
  // 删除标注时的二次确认（仅当该标注带想法）
  const [deleteConfirm, setDeleteConfirm] = useState<{
    highlightId: string; cfiRange: string; hasNote: boolean;
  } | null>(null);
  // 想法编辑器草稿内容（用于判断是否有未保存修改）
  const [noteDraft, setNoteDraft] = useState('');
  // 想法编辑器 textarea 引用（用于在手势栈内直接聚焦，触发 iOS 软键盘）
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  // 未保存确认弹窗
  const [noteUnsavedConfirm, setNoteUnsavedConfirm] = useState(false);
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
  const savedSelectionRef = useRef<{ range: Range; doc: any; text: string; cfiRange?: string } | null>(null); // 选区会话快照
  const selectionPopupRef = useRef<typeof selectionPopup>(null); // 工具条当前状态（供 iframe 内点击判断）
  const popupShownAtRef = useRef(0); // 工具条显示时间（避免点击瞬间被 selected 事件隐藏）
  const markClickedAtRef = useRef(0); // 最近一次点击标注的时间（避免 touchend 的翻页逻辑清掉工具条造成闪烁）
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
            // 刚点过标注（markClicked 500ms 内）→ 这次点击是"打开标注工具条"，
            // 不能再走翻页/切工具栏逻辑，否则会把刚弹出的工具条清掉（闪烁）
            if (Date.now() - markClickedAtRef.current < 500) return;
            setSelectionPopup(null);
            // 翻页热区扩大（左右各 40%），方便左手单手操作
            if (screenX < width * 0.4) {
              rendition.prev();
            } else if (screenX > width * 0.6) {
              if (atEndRef.current) {
                // 已到最后一页，继续后翻 → 显示读完完成页
                finishedRef.current = true;
                setFinishedOpen(true);
                markBookFinished();
              } else {
                rendition.next();
              }
            } else {
              setShowToolbar(prev => !prev);
            }
          };

          // 标记本书已读完（记录首次完成时间，供统计页使用）
          const markBookFinished = () => {
            if (!bookId) return;
            const cur = useAppStore.getState().books.find(b => b.id === bookId);
            updateBook(bookId, {
              progress: 1,
              lastReadAt: Date.now(),
              finishedAt: cur?.finishedAt || Date.now(),   // 只记首次
            });
          };

          // 下一页（含读完完成页逻辑）
          const doNextPage = () => {
            if (atEndRef.current) {
              finishedRef.current = true;
              setFinishedOpen(true);
              markBookFinished();
            } else {
              rendition.next();
            }
          };

          if (isTouchDevice) {
            let touchStartX = 0;
            let touchStartY = 0;
            let touchStartTime = 0;
            let pullTriggered = false;
            // 本次触摸「按下的那一刻」是否已存在选区。
            // iOS 拖动选择手柄时会让选区短暂折叠，touchend 再看就变空了，
            // 用按下时的快照才能正确判断"这次触摸是不是在操作选区"。
            let hadSelectionAtTouchStart = false;

            doc.addEventListener('touchstart', (ev: TouchEvent) => {
              const touch = ev.touches[0];
              touchStartX = touch.clientX;
              touchStartY = touch.clientY;
              touchStartTime = Date.now();
              pullTriggered = false;
              const s = win?.getSelection?.();
              hadSelectionAtTouchStart =
                !!(s && !s.isCollapsed && s.toString().trim().length > 0);
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
              // ===== 有选区时：不做任何事（不取消、不翻页）=====
              // 取消选择完全交给浏览器默认行为：点选区外空白 → 浏览器自动清空选区
              // → selectionchange 触发 → 关闭工具条。
              // 这样碰手柄/点选区内都不会误清选区，可以反复拖动调整范围。
              const liveSel = win?.getSelection?.();
              const hasSelection = !!(
                liveSel && !liveSel.isCollapsed && liveSel.toString().trim().length > 0
              );
              if (hasSelection) return;

              // 按下那一刻有选区 → 本次触摸是在操作选区（比如拖手柄导致选区短暂折叠），
              // 绝不能翻页，否则重渲染会清空选区。
              // 注意：这里用按下时的快照，而不是此刻的实时状态。
              if (hadSelectionAtTouchStart) {
                hadSelectionAtTouchStart = false;
                return;
              }

              // 工具条显示中但无选区（例如标注操作模式）→ 点阅读区关闭
              // 「刚点过标注」的 500ms 内跳过，避免和 markClicked 抢时序导致闪烁
              if (document.querySelector('.text-selection-popup')) {
                if (Date.now() - markClickedAtRef.current >= 500) {
                  setSelectionPopup(null);
                }
                return;
              }

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

            // 选区被清空（点空白、系统关闭选择菜单）→ 关闭工具条
            // 注意两个排除条件，否则「点击划线」时工具条会闪烁：
            //  1) 标注操作模式（mark）下选区本来就是空的，不能因此关闭
            //  2) 刚打开 600ms 内跳过（避免与 markClicked 的时序竞争）
            doc.addEventListener('selectionchange', () => {
              try {
                const sel = win?.getSelection?.();
                const isEmpty = !sel || sel.isCollapsed || sel.toString().trim().length === 0;
                // 选区还在（包括拖动手柄过程中的变化）→ 刷新活动时间，
                // 让 touchend 的「3 秒内不翻页」保护期始终有效
                if (!isEmpty) {
                  lastSelectionActivityRef.current = Date.now();
                  return;
                }

                const current = selectionPopupRef.current;
                if (!current) return;                 // 本来就没显示
                if (current.mark) return;             // 标注操作模式不据此关闭
                if (Date.now() - popupShownAtRef.current < 600) return;  // 刚打开，忽略

                if (document.querySelector('.text-selection-popup')) {
                  setSelectionPopup(null);
                }
              } catch {}
            }, { passive: true });
          } else {
            doc.addEventListener('click', (ev: MouseEvent) => {
              const sel = win?.getSelection?.()?.toString?.();
              if (sel && sel.trim().length > 0) return;
              handleTap(ev.clientX);
            });
          }

          // ===== 兜底：记录选区活动时间 =====
          // 主要逻辑已改用 epub.js 的 selected 事件（它内部已监听 selectionchange 并 250ms 防抖 + 生成 CFI）。
          // 这里只保留一个极轻的轮询，用来维护 lastSelectionActivityRef（供 touchend 判断"别翻页"）。
          // 之前的轮询会用 rendition.cfis（epub.js 中不存在）生成 CFI，永远失败，已移除。
          if (selectionPollTimerRef.current) clearInterval(selectionPollTimerRef.current);
          selectionPollTimerRef.current = setInterval(() => {
            try {
              const sel = win?.getSelection?.();
              if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
                const t = sel.toString();
                if (t && t.trim().length > 0) {
                  lastSelectionActivityRef.current = Date.now();
                }
              }
            } catch {}
          }, 300);
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

        // ===== 文本选择：基于 epub.js 自己的 selected 事件 =====
        // epub.js 内部已监听 selectionchange + 250ms 防抖 + 用 EpubCFI 生成 cfiRange。
        // 我们只在其上再延迟 400ms 显示（接近 iOS 原生菜单的响应速度，又能避免拖手柄停顿误弹）。
        let selectionShowTimer: ReturnType<typeof setTimeout> | null = null;

        rendition.on('selected', (cfiRange: string, contents: any) => {
          if (destroyed) return;

          const range = rendition.getRange(cfiRange);
          if (!range) return;
          const text = range.toString().trim();
          if (!text) return;

          // 1) 立即保存「选区会话」快照（供整段/划线/想法使用）
          const ownerDoc =
            range.commonAncestorContainer?.ownerDocument ||
            range.startContainer?.ownerDocument ||
            null;
          lastSelectionActivityRef.current = Date.now();
          savedSelectionRef.current = ownerDoc
            ? { range: range.cloneRange(), doc: ownerDoc, text, cfiRange }
            : null;

          // 2) 选区变了 → 收起已显示的工具条（只隐藏 UI，不清除选区、不阻断拖动）
          //    但刚显示 500ms 内不隐藏：避免用户点击工具条按钮的那一刻被隐藏掉（点击落空）
          if (Date.now() - popupShownAtRef.current > 500) {
            setSelectionPopup(null);
          }

          // 3) 重新计时：稳定 300ms 没有新的 selected 才显示（更接近 iOS 原生菜单手感）
          if (selectionShowTimer) clearTimeout(selectionShowTimer);
          selectionShowTimer = setTimeout(() => {
            if (destroyed) return;
            try {
              const snap = savedSelectionRef.current;
              if (!snap) return;
              // 显示前校验快照节点仍在文档中
              const node = snap.range.commonAncestorContainer;
              if (!node || !snap.doc?.contains?.(node)) return;

              const r = snap.range;
              const rect = r.getBoundingClientRect();
              if (!rect || (rect.width === 0 && rect.height === 0)) return;
              const viewerRect = container.getBoundingClientRect();
              const isSingleWord = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(snap.text);
              popupShownAtRef.current = Date.now();
              setSelectionPopup({
                y: rect.bottom - viewerRect.top + 8,
                rectTop: rect.top - viewerRect.top,
                text: snap.text,
                cfiRange: snap.cfiRange || '',
                isSingleWord,
              });
            } catch (e) {
              console.warn('[Reader] show selection popup failed:', e);
            }
          }, 300);
        });

        // 监听高亮点击：先弹工具条（进入标注操作模式），而不是直接弹编辑框
        rendition.on('markClicked', (cfiRange: string, data: any) => {
          // 同一位置可能同时有「划线」和「想法」两条，优先匹配带想法的
          const candidates = useAppStore.getState().highlights.filter(h => h.cfiRange === cfiRange);
          const hl = candidates.find(h => h.note && h.note.trim().length > 0) || candidates[0];
          if (!hl) return;

          // 定位到该标注所在的矩形
          const range = rendition.getRange(cfiRange);
          let y = window.innerHeight * 0.4;
          let rectTop = y;
          if (range) {
            const rect = range.getBoundingClientRect();
            const viewerRect = container.getBoundingClientRect();
            y = rect.bottom - viewerRect.top + 8;
            rectTop = rect.top - viewerRect.top;
          }

          // 记录点击时间：touchend 的翻页/切工具栏逻辑在 500ms 内要跳过，
          // 否则它会 setSelectionPopup(null) 把刚弹出的工具条清掉（表现为"闪一下"）
          markClickedAtRef.current = Date.now();
          popupShownAtRef.current = Date.now();
          setSelectionPopup({
            y,
            rectTop,
            text: hl.text,
            cfiRange,
            isSingleWord: false,
            mark: {
              highlightId: hl.id,
              hasNote: !!(hl.note && hl.note.trim().length > 0),
            },
          });
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

  // 同步工具条状态到 ref（供 iframe 内点击判断）
  useEffect(() => {
    selectionPopupRef.current = selectionPopup;
  }, [selectionPopup]);

  // 选择工具条：点击工具条外部关闭（替代全屏遮罩，避免遮罩挡住选择手柄）
  // 注意：这只覆盖「外层页面」的点击；iframe 内的点击由 touchend 逻辑处理
  useEffect(() => {
    if (!selectionPopup) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement | null;
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
      if (bookId) {
        const cur = useAppStore.getState().books.find(b => b.id === bookId);
        updateBook(bookId, {
          progress: 1,
          lastReadAt: Date.now(),
          finishedAt: cur?.finishedAt || Date.now(),
        });
      }
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
    const rendition = renditionRef.current;
    if (!rendition) {
      console.warn('[Reader] 整段：rendition 不可用');
      return;
    }

    const blockTags = ['P', 'DIV', 'LI', 'SECTION', 'BLOCKQUOTE', 'TD', 'H1', 'H2', 'H3', 'ARTICLE'];

    // ===== 诊断日志：点击前的选区状态（便于真机排查）=====
    const snap = savedSelectionRef.current;
    const snapNode = snap?.range?.commonAncestorContainer;
    const snapValid = !!(snap && snap.doc && snapNode && snap.doc.contains?.(snapNode));
    console.debug('[Reader] 整段-点击前:', {
      hasSnapshot: !!snap,
      snapshotValid: snapValid,
      snapshotTextLen: snap?.text?.length ?? 0,
      popupCfi: selectionPopup.cfiRange,
    });

    try {
      // ===== 1) 取有效 Range：快照优先（校验节点仍在文档中），否则用 CFI 重新解析 =====
      let range: Range | null = null;
      let doc: any = null;
      let source = 'none';

      if (snapValid) {
        range = snap!.range;
        doc = snap!.doc;
        source = 'snapshot';
      } else if (selectionPopup.cfiRange) {
        // rendition.getRange(cfi) 只从「当前可见 view」解析，返回 Range 或 undefined
        const r = rendition.getRange(selectionPopup.cfiRange);
        if (r) {
          range = r;
          doc = r.commonAncestorContainer?.ownerDocument || r.startContainer?.ownerDocument || null;
          source = 'cfi';
        }
      }

      if (!range || !doc) {
        console.warn('[Reader] 整段失败：无法获取有效 Range（快照失效且 CFI 解析失败）');
        return;
      }

      // ===== 2) 用起点节点向上找段落级元素 =====
      // 注意：跨段选择时 commonAncestorContainer 可能是容器，用 startContainer 更贴近用户起点
      let node: any = range.startContainer || range.commonAncestorContainer;
      if (node?.nodeType === 3) node = node.parentNode; // Text 节点 → 父元素
      while (node && node !== doc.body && !blockTags.includes(node.nodeName)) {
        node = node.parentNode;
      }
      if (!node || node === doc.body) {
        console.warn('[Reader] 整段失败：未找到段落级元素（startContainer 链上没有 P/DIV/LI 等）');
        return;
      }

      // ===== 3) 构造段落范围 =====
      const paraRange = doc.createRange();
      paraRange.selectNodeContents(node);
      if (paraRange.collapsed) {
        console.warn('[Reader] 整段失败：段落内容为空');
        return;
      }

      // ===== 4) 同步 iframe 内的可视选区 =====
      const win = doc.defaultView;
      const liveSel = win?.getSelection?.();
      if (liveSel) {
        liveSel.removeAllRanges();
        liveSel.addRange(paraRange);
      }

      // ===== 5) 生成新 CFI（用 Contents.cfiFromRange，epub.js 官方接口）=====
      let cfiRange = '';
      const contentsList = rendition.getContents?.() || [];
      for (const c of contentsList) {
        if (c?.document === doc && typeof c.cfiFromRange === 'function') {
          cfiRange = c.cfiFromRange(paraRange);
          break;
        }
      }
      if (!cfiRange) {
        console.warn('[Reader] 整段失败：无法从段落 Range 生成 CFI');
        return;
      }

      const text = paraRange.toString().trim();
      if (!text) {
        console.warn('[Reader] 整段失败：段落文本为空');
        return;
      }

      // ===== 6) 主动同步：弹窗内容、快照、选区会话 =====
      savedSelectionRef.current = {
        range: paraRange.cloneRange(),
        doc,
        text,
        cfiRange,
      };
      lastSelectionActivityRef.current = Date.now();
      setSelectionPopup({ ...selectionPopup, cfiRange, text });
      console.debug('[Reader] 整段-成功:', { source, textLen: text.length, cfiRange });
    } catch (e) {
      console.warn('[Reader] select paragraph failed:', e);
    }
  };

  // Handle highlight
  // 规则：如果新划线与已有「纯划线」重叠或首尾相接，则合并成一条（取并集）；
  //       否则新建一条。想法（note 非空）不参与合并。
  const handleHighlight = () => {
    if (!selectionPopup || !bookId) return;

    const text = typeof selectionPopup.text === 'string'
      ? selectionPopup.text
      : String(selectionPopup.text || '');

    const rendition = renditionRef.current;

    // ===== 1) 尝试与已有纯划线合并 =====
    if (rendition) {
      const newRange = rendition.getRange(selectionPopup.cfiRange);
      if (newRange) {
        const pureHighlights = useAppStore.getState().highlights.filter(
          h => h.bookId === bookId && (!h.note || h.note.trim().length === 0)
        );

        for (const oldHl of pureHighlights) {
          const oldRange = rendition.getRange(oldHl.cfiRange);
          if (!oldRange) continue;

          // 必须同一 document（同一章节）才能比较边界
          const newDoc = newRange.startContainer?.ownerDocument;
          const oldDoc = oldRange.startContainer?.ownerDocument;
          if (!newDoc || !oldDoc || newDoc !== oldDoc) continue;

          try {
            const oldR = oldDoc.createRange();
            oldR.setStart(oldRange.startContainer, oldRange.startOffset);
            oldR.setEnd(oldRange.endContainer, oldRange.endOffset);

            const newR = newDoc.createRange();
            newR.setStart(newRange.startContainer, newRange.startOffset);
            newR.setEnd(newRange.endContainer, newRange.endOffset);

            // 重叠或首尾相接判定：oldR.end >= newR.start 且 newR.end >= oldR.start
            const overlapping =
              oldR.compareBoundaryPoints(Range.END_TO_START, newR) >= 0 &&
              newR.compareBoundaryPoints(Range.END_TO_START, oldR) >= 0;
            if (!overlapping) continue;

            // 合并：起点取较早的，终点取较晚的
            const merged = newDoc.createRange();
            if (oldR.compareBoundaryPoints(Range.START_TO_START, newR) <= 0) {
              merged.setStart(oldR.startContainer, oldR.startOffset);
            } else {
              merged.setStart(newR.startContainer, newR.startOffset);
            }
            if (oldR.compareBoundaryPoints(Range.END_TO_END, newR) >= 0) {
              merged.setEnd(oldR.endContainer, oldR.endOffset);
            } else {
              merged.setEnd(newR.endContainer, newR.endOffset);
            }

            // 生成合并后的 CFI（用 Contents.cfiFromRange 官方接口）
            let mergedCfi = '';
            for (const c of (rendition.getContents?.() || [])) {
              if (c?.document === newDoc && typeof c.cfiFromRange === 'function') {
                mergedCfi = c.cfiFromRange(merged);
                break;
              }
            }
            if (!mergedCfi) continue;

            const mergedText = merged.toString().trim();
            if (!mergedText) continue;

            // 更新旧标注 → 移除旧高亮 → 添加新高亮
            updateHighlight(oldHl.id, {
              cfiRange: mergedCfi,
              text: mergedText,
              updatedAt: Date.now(),
            });
            try {
              rendition.annotations.remove(oldHl.cfiRange, 'highlight');
            } catch {}
            rendition.annotations.add('highlight', mergedCfi, {}, undefined, undefined, highlightStyles());

            setSelectionPopup(null);
            return;
          } catch (e) {
            console.warn('[Reader] merge highlight failed:', e);
          }
        }
      }
    }

    // ===== 2) 没有可合并的 → 新建划线 =====
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
    rendition?.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles());
    setSelectionPopup(null);
  };

  // Handle add note（新建想法 / 编辑已有想法）
  const handleAddNote = () => {
    if (!selectionPopup) return;

    // 标注模式：直接打开该标注的编辑器（编辑已有想法）
    if (selectionPopup.mark) {
      const hl = useAppStore.getState().highlights.find(h => h.id === selectionPopup.mark!.highlightId);
      if (hl) {
        setSelectionPopup(null);
        setNoteDraft(hl.note || '');
        // flushSync 强制同步渲染 → 随后立即 focus，仍在用户手势栈内，iOS 才会弹键盘
        flushSync(() => {
          setNoteDialog({
            highlightId: hl.id,
            text: hl.text,
            cfiRange: hl.cfiRange,
            existingNote: hl.note,
          });
        });
        try { noteTextareaRef.current?.focus(); } catch {}
      }
      return;
    }

    // 普通模式：打开空白编辑器（此时【不创建任何标注】，保存时才创建）
    if (!bookId) return;
    const text = typeof selectionPopup.text === 'string'
      ? selectionPopup.text
      : String(selectionPopup.text || '');

    setSelectionPopup(null);
    setNoteDraft('');
    flushSync(() => {
      setNoteDialog({ text, cfiRange: selectionPopup.cfiRange });
    });
    try { noteTextareaRef.current?.focus(); } catch {}
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

  // Save note：编辑已有标注 → 更新；新建 → 此时才创建标注（空内容则不创建）
  const handleSaveNote = (note: string) => {
    if (!noteDialog) return;
    const trimmed = note.trim();

    if (noteDialog.highlightId) {
      // 编辑已有标注
      updateHighlight(noteDialog.highlightId, { note: trimmed, updatedAt: Date.now() });
    } else if (trimmed && bookId) {
      // 新建：只有真正写了内容才创建标注（避免"没写就退出"留下空标注）
      const hl: Highlight = {
        id: generateId(),
        bookId,
        chapterHref: book?.currentChapterHref || '',
        cfiRange: noteDialog.cfiRange,
        text: noteDialog.text,
        color: MARK_COLOR,
        note: trimmed,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addHighlight(hl);
      renditionRef.current?.annotations.add('underline', hl.cfiRange, {}, undefined, undefined, noteStyles());
    }
    // 新建 + 空内容 → 什么都不创建

    setNoteDialog(null);
    setNoteDraft('');
    setNoteUnsavedConfirm(false);
  };

  // 请求关闭想法编辑器：有未保存修改时弹确认（点「取消」或点编辑区外都走这里）
  const requestCloseNoteEditor = () => {
    if (!noteDialog) return;
    const initial = noteDialog.existingNote || '';
    if (noteDraft !== initial) {
      setNoteUnsavedConfirm(true);
      return;
    }
    setNoteDialog(null);
    setNoteDraft('');
  };

  // 不保存，直接关闭
  const discardNoteAndClose = () => {
    setNoteUnsavedConfirm(false);
    setNoteDialog(null);
    setNoteDraft('');
  };

  // 保存并关闭（逻辑与 handleSaveNote 一致：新建时才创建标注）
  const saveNoteAndClose = () => {
    if (!noteDialog) return;
    const trimmed = noteDraft.trim();

    if (noteDialog.highlightId) {
      updateHighlight(noteDialog.highlightId, { note: trimmed, updatedAt: Date.now() });
    } else if (trimmed && bookId) {
      const hl: Highlight = {
        id: generateId(),
        bookId,
        chapterHref: book?.currentChapterHref || '',
        cfiRange: noteDialog.cfiRange,
        text: noteDialog.text,
        color: MARK_COLOR,
        note: trimmed,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addHighlight(hl);
      renditionRef.current?.annotations.add('underline', hl.cfiRange, {}, undefined, undefined, noteStyles());
    }

    setNoteUnsavedConfirm(false);
    setNoteDialog(null);
    setNoteDraft('');
  };

  // 删除标注（工具条上的「删除」按钮）
  // - 无想法：直接删除
  // - 有想法：弹二次确认（删除划线和想法 / 仅删除想法）
  const handleDeleteMark = () => {
    const mark = selectionPopup?.mark;
    if (!mark) return;
    const hl = useAppStore.getState().highlights.find(h => h.id === mark.highlightId);
    if (!hl) {
      setSelectionPopup(null);
      return;
    }

    if (!mark.hasNote) {
      removeHighlight(hl.id);
      try {
        renditionRef.current?.annotations.remove(hl.cfiRange, 'highlight');
      } catch (e) {
        console.warn('[Reader] Remove annotation failed:', e);
      }
      setSelectionPopup(null);
      return;
    }

    // 带想法 → 二次确认
    setSelectionPopup(null);
    setDeleteConfirm({ highlightId: hl.id, cfiRange: hl.cfiRange, hasNote: true });
  };

  // 确认删除：划线和想法一起删
  const confirmDeleteBoth = () => {
    if (!deleteConfirm) return;
    const hl = useAppStore.getState().highlights.find(h => h.id === deleteConfirm.highlightId);
    if (hl) {
      removeHighlight(hl.id);
      try {
        renditionRef.current?.annotations.remove(hl.cfiRange, 'underline');
        renditionRef.current?.annotations.remove(hl.cfiRange, 'highlight');
      } catch (e) {
        console.warn('[Reader] Remove annotation failed:', e);
      }
    }
    setDeleteConfirm(null);
  };

  // 确认删除：仅删除想法（保留划线 → 改回 highlight 样式）
  const confirmDeleteNoteOnly = () => {
    if (!deleteConfirm) return;
    const hl = useAppStore.getState().highlights.find(h => h.id === deleteConfirm.highlightId);
    if (hl) {
      updateHighlight(hl.id, { note: '', updatedAt: Date.now() });
      try {
        renditionRef.current?.annotations.remove(hl.cfiRange, 'underline');
        renditionRef.current?.annotations.add('highlight', hl.cfiRange, {}, undefined, undefined, highlightStyles());
      } catch (e) {
        console.warn('[Reader] Replace annotation failed:', e);
      }
    }
    setDeleteConfirm(null);
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

      {/* 选择/标注工具条 */}
      {selectionPopup && (
        <TextSelectionPopup
          y={selectionPopup.y}
          rectTop={selectionPopup.rectTop}
          text={selectionPopup.text}
          isSingleWord={selectionPopup.isSingleWord}
          mark={selectionPopup.mark}
          onCopy={handleCopy}
          onHighlight={handleHighlight}
          onNote={handleAddNote}
          onLookup={handleLookup}
          onSelectParagraph={handleSelectParagraph}
          onDeleteMark={handleDeleteMark}
        />
      )}

      {/* 想法编辑器：底部面板（贴近键盘，引用与输入区分开） */}
      {noteDialog && (
        <div
          className="note-editor-overlay"
          onClick={() => {
            // 锁定期间忽略（iOS tap 的 touchend 触发后，随后的 click 会落到遮罩上）
            if (noteDialogLockRef.current) return;
            // 点编辑区外 → 有未保存修改则弹确认
            requestCloseNoteEditor();
          }}
        >
          <div className="note-editor-wrap" onClick={e => e.stopPropagation()}>
            <NoteEditor
              initial={noteDialog.existingNote || ''}
              quote={noteDialog.text}
              onSave={handleSaveNote}
              onCancel={requestCloseNoteEditor}
              onChange={setNoteDraft}
              textareaRef={noteTextareaRef}
            />
          </div>
        </div>
      )}

      {/* 未保存想法确认（用 modal-overlay-top 盖在想法编辑器之上） */}
      {noteUnsavedConfirm && (
        <div className="modal-overlay modal-overlay-top" onClick={() => setNoteUnsavedConfirm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>想法未保存</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '8px 0 16px', lineHeight: 1.5 }}>
              你有未保存的想法，是否保存？
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={discardNoteAndClose}>不保存</button>
              <button className="btn btn-primary" onClick={saveNoteAndClose}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除带想法的标注：二次确认 */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>删除标注</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '8px 0 16px', lineHeight: 1.5 }}>
              这条标注包含想法，请选择删除方式：
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-danger" onClick={confirmDeleteBoth}>删除划线和想法</button>
              <button className="btn btn-secondary" onClick={confirmDeleteNoteOnly}>仅删除想法</button>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>取消</button>
            </div>
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

// 想法编辑器：底部面板，顶部「取消 | 想法 | 保存」，引用与输入区分开
function NoteEditor({ initial, quote, onSave, onCancel, onChange, textareaRef }: {
  initial: string;
  quote: string;
  onSave: (note: string) => void;
  onCancel: () => void;
  onChange: (text: string) => void;
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState(initial);

  // iOS 要求 focus() 在「用户手势执行栈」内调用才会弹出软键盘。
  // useLayoutEffect 在 DOM 更新后、浏览器重绘前同步执行，最接近手势时机（setTimeout 会脱离手势被拒绝）。
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    try { el.focus(); } catch {}
    // 兜底：部分 iOS 版本需要微延迟再试一次
    const t = setTimeout(() => {
      try { el.focus(); } catch {}
    }, 60);
    return () => clearTimeout(t);
  }, []);

  const handleChange = (v: string) => {
    setText(v);
    onChange(v);
  };

  return (
    <div className="note-editor-sheet">
      <div className="note-editor-header">
        <button className="note-editor-btn" onClick={onCancel}>取消</button>
        <span className="note-editor-title">想法</span>
        <button
          className="note-editor-btn note-editor-save"
          onClick={() => onSave(text)}
          disabled={!text.trim()}
          style={!text.trim() ? { opacity: 0.4 } : undefined}
        >
          保存
        </button>
      </div>

      {/* 引用原文：与输入区区分开 */}
      <div className="note-editor-quote">"{quote}"</div>

      <textarea
        ref={textareaRef}
        className="note-editor-textarea"
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder="写下你的想法…"
        autoFocus
      />
    </div>
  );
}
