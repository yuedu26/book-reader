import { create } from 'zustand';
import type {
  Book, Highlight, Bookmark, VocabularyWord,
  ReadingStat, ReadingSettings, ThemeName,
} from '@/types';

// 主题颜色映射
export const themeMap: Record<ThemeName, { bg: string; text: string; name: string }> = {
  white:  { bg: '#FFFFFF', text: '#333333', name: '银河白' },
  green:  { bg: '#C7EDCC', text: '#333333', name: '豆沙绿' },
  yellow: { bg: '#FAF9DE', text: '#333333', name: '杏仁黄' },
  brown:  { bg: '#FFF2E2', text: '#333333', name: '秋叶褐' },
  dark:   { bg: '#1A1A1A', text: '#CCCCCC', name: '夜间黑' },
};

const defaultSettings: ReadingSettings = {
  fontSize: 16,
  fontFamily: 'Georgia',
  theme: 'white',
  lineHeight: 1.8,
  pageMode: 'paginated',
};

const STORAGE_KEY = 'reader_pwa_data';

interface PersistedState {
  books: Book[];
  highlights: Highlight[];
  bookmarks: Bookmark[];
  vocabulary: VocabularyWord[];
  readingStats: ReadingStat[];
  settings: ReadingSettings;
  lastBackupAt: number;
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function persist(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      books: state.books,
      highlights: state.highlights,
      bookmarks: state.bookmarks,
      vocabulary: state.vocabulary,
      readingStats: state.readingStats,
      settings: state.settings,
      lastBackupAt: state.lastBackupAt,
    }));
  } catch {}
}

const initial = loadPersisted();

interface AppState extends PersistedState {
  // 书籍
  addBook: (book: Book) => void;
  removeBook: (id: string) => void;
  updateBook: (id: string, updates: Partial<Book>) => void;

  // 高亮
  addHighlight: (h: Highlight) => void;
  removeHighlight: (id: string) => void;
  updateHighlight: (id: string, updates: Partial<Highlight>) => void;

  // 书签
  addBookmark: (b: Bookmark) => void;
  removeBookmark: (id: string) => void;

  // 生词
  addWord: (w: VocabularyWord) => void;
  removeWord: (id: string) => void;
  incrementReview: (id: string) => void;

  // 统计
  addReadingTime: (bookId: string, seconds: number) => void;

  // 设置
  updateSettings: (u: Partial<ReadingSettings>) => void;

  // 备份
  setLastBackup: (ts: number) => void;

  // 全量恢复
  restoreAll: (data: PersistedState) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  books: initial.books ?? [],
  highlights: initial.highlights ?? [],
  bookmarks: initial.bookmarks ?? [],
  vocabulary: initial.vocabulary ?? [],
  readingStats: initial.readingStats ?? [],
  settings: { ...defaultSettings, ...(initial.settings ?? {}) },
  lastBackupAt: initial.lastBackupAt ?? 0,

  // 书籍
  addBook: (book) => set((s) => {
    const next = { ...s, books: [...s.books, book] };
    persist(next);
    return next;
  }),

  removeBook: (id) => set((s) => {
    const next = {
      ...s,
      books: s.books.filter(b => b.id !== id),
      highlights: s.highlights.filter(h => h.bookId !== id),
      bookmarks: s.bookmarks.filter(b => b.bookId !== id),
      vocabulary: s.vocabulary.filter(v => v.bookId !== id),
      readingStats: s.readingStats.filter(r => r.bookId !== id),
    };
    persist(next);
    return next;
  }),

  updateBook: (id, updates) => set((s) => {
    const next = {
      ...s,
      books: s.books.map(b => b.id === id ? { ...b, ...updates } : b),
    };
    persist(next);
    return next;
  }),

  // 高亮
  addHighlight: (h) => set((s) => {
    const next = { ...s, highlights: [...s.highlights, h] };
    persist(next);
    return next;
  }),

  removeHighlight: (id) => set((s) => {
    const next = { ...s, highlights: s.highlights.filter(h => h.id !== id) };
    persist(next);
    return next;
  }),

  updateHighlight: (id, updates) => set((s) => {
    const next = {
      ...s,
      highlights: s.highlights.map(h => h.id === id ? { ...h, ...updates } : h),
    };
    persist(next);
    return next;
  }),

  // 书签
  addBookmark: (b) => set((s) => {
    const next = { ...s, bookmarks: [...s.bookmarks, b] };
    persist(next);
    return next;
  }),

  removeBookmark: (id) => set((s) => {
    const next = { ...s, bookmarks: s.bookmarks.filter(b => b.id !== id) };
    persist(next);
    return next;
  }),

  // 生词
  addWord: (w) => set((s) => {
    const next = { ...s, vocabulary: [...s.vocabulary, w] };
    persist(next);
    return next;
  }),

  removeWord: (id) => set((s) => {
    const next = { ...s, vocabulary: s.vocabulary.filter(v => v.id !== id) };
    persist(next);
    return next;
  }),

  incrementReview: (id) => set((s) => {
    const next = {
      ...s,
      vocabulary: s.vocabulary.map(v =>
        v.id === id ? { ...v, reviewCount: v.reviewCount + 1 } : v
      ),
    };
    persist(next);
    return next;
  }),

  // 统计
  addReadingTime: (bookId, seconds) => set((s) => {
    const today = new Date().toISOString().split('T')[0];
    const existing = s.readingStats.find(r => r.bookId === bookId && r.date === today);
    const readingStats = existing
      ? s.readingStats.map(r =>
          r.bookId === bookId && r.date === today
            ? { ...r, duration: r.duration + seconds }
            : r
        )
      : [...s.readingStats, { bookId, date: today, duration: seconds }];
    const next = { ...s, readingStats };
    persist(next);
    return next;
  }),

  // 设置
  updateSettings: (u) => set((s) => {
    const next = { ...s, settings: { ...s.settings, ...u } };
    persist(next);
    return next;
  }),

  // 备份
  setLastBackup: (ts) => set((s) => {
    const next = { ...s, lastBackupAt: ts };
    persist(next);
    return next;
  }),

  // 全量恢复
  restoreAll: (data) => set(() => {
    persist(data);
    return data;
  }),
}));
