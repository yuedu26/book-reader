// 书籍类型
export interface Book {
  id: string;
  title: string;
  author: string;
  cover?: string; // 封面图片 base64 data URL
  progress: number; // 阅读进度 0-1
  currentLocation: string; // epub.js CFI 或 href
  currentChapterHref: string;
  totalChapters: number;
  addedAt: number;
  lastReadAt: number;
  fileName: string;
}

// 章节类型
export interface Chapter {
  id: string;
  label: string;
  href: string;
  subitems?: Chapter[];
}

// 高亮/划线类型
export interface Highlight {
  id: string;
  bookId: string;
  chapterHref: string;
  cfiRange: string;
  text: string;
  color: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

// 书签类型
export interface Bookmark {
  id: string;
  bookId: string;
  chapterHref: string;
  cfi: string;
  label?: string;
  chapterTitle?: string;
  createdAt: number;
}

// 生词类型
export interface VocabularyWord {
  id: string;
  bookId: string;
  chapterHref: string;
  chapterTitle?: string;
  word: string;
  definition?: string;
  context?: string;
  createdAt: number;
  reviewCount: number;
}

// 阅读统计类型
export interface ReadingStat {
  bookId: string;
  date: string; // YYYY-MM-DD
  duration: number; // 秒
}

// 阅读设置
export type ThemeName = 'white' | 'green' | 'yellow' | 'brown' | 'dark';

export interface ReadingSettings {
  fontSize: number;
  fontFamily: string;
  theme: ThemeName;
  lineHeight: number;
  pageMode: 'paginated' | 'scrolled';
  highlightColor: string; // 划线高亮颜色（默认黄色）
}

// 备份数据
export interface BackupData {
  version: string;
  timestamp: number;
  books: Book[];
  highlights: Highlight[];
  bookmarks: Bookmark[];
  vocabulary: VocabularyWord[];
  readingStats: ReadingStat[];
  settings: ReadingSettings;
}

// 主题颜色
export interface ThemeColors {
  bg: string;
  text: string;
  name: string;
}
