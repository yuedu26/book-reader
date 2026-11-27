import type { BackupData, Book, Highlight, VocabularyWord } from '@/types';
import { useAppStore } from '@/stores';

/**
 * 导出备份为 JSON 文件
 */
export function exportBackup(): void {
  const state = useAppStore.getState();
  const data: BackupData = {
    version: '1.0.0',
    timestamp: Date.now(),
    books: state.books,
    highlights: state.highlights,
    bookmarks: state.bookmarks,
    vocabulary: state.vocabulary,
    readingStats: state.readingStats,
    settings: state.settings,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reader_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  state.setLastBackup(Date.now());
  
  // 清除首次提醒记录
  localStorage.removeItem('reader_pwa_first_backup_reminder');
}

/**
 * 从 JSON 文件导入备份
 */
export function importBackup(): Promise<void> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file')); return; }
      try {
        const text = await file.text();
        const data = JSON.parse(text) as BackupData;
        if (!data.version || !data.books) {
          reject(new Error('Invalid backup format'));
          return;
        }
        useAppStore.getState().restoreAll({
          books: data.books,
          highlights: data.highlights ?? [],
          bookmarks: data.bookmarks ?? [],
          vocabulary: data.vocabulary ?? [],
          readingStats: data.readingStats ?? [],
          settings: data.settings ?? useAppStore.getState().settings,
          lastBackupAt: Date.now(),
        });
        
        // 清除首次提醒记录
        localStorage.removeItem('reader_pwa_first_backup_reminder');
        
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

/**
 * 导出想法/笔记为 TXT（只导出带 note 的条目）
 */
export function exportNotes(bookId: string, bookTitle: string): void {
  const state = useAppStore.getState();
  const notes = state.highlights
    .filter(h => h.bookId === bookId && h.note && h.note.trim().length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  let text = `《${bookTitle}》想法导出\n`;
  text += `导出时间：${new Date().toLocaleString()}\n`;
  text += `共 ${notes.length} 条想法\n`;
  text += `${'='.repeat(40)}\n\n`;

  notes.forEach((h, i) => {
    text += `[${i + 1}] ${h.text}\n`;
    text += `  想法：${h.note}\n`;
    text += `  时间：${new Date(h.updatedAt).toLocaleString()}\n\n`;
  });

  if (notes.length === 0) {
    text += `（暂无想法）\n`;
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${bookTitle}_想法.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

const FIRST_REMINDER_KEY = 'reader_pwa_first_backup_reminder';
const REMIND_INTERVAL_DAYS = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * 备份提醒详情：返回是否需要提醒、距上次备份多少天、以及是否从未备份过
 */
export function getBackupReminder(): {
  shouldRemind: boolean;
  days: number;
  neverBackedUp: boolean;
} {
  const state = useAppStore.getState();

  // 没有任何书籍数据 → 无需提醒
  if (state.books.length === 0) {
    return { shouldRemind: false, days: 0, neverBackedUp: false };
  }

  // 从未备份过：从"首次发现需要备份"的时间点起算
  if (state.lastBackupAt === 0) {
    const raw = localStorage.getItem(FIRST_REMINDER_KEY);
    if (!raw) {
      // 首次发现有数据 → 立刻记录时间，并【立即提醒一次】
      localStorage.setItem(FIRST_REMINDER_KEY, Date.now().toString());
      return { shouldRemind: true, days: 0, neverBackedUp: true };
    }
    const days = Math.floor((Date.now() - parseInt(raw, 10)) / MS_PER_DAY);
    return { shouldRemind: days >= REMIND_INTERVAL_DAYS, days, neverBackedUp: true };
  }

  // 备份过：超过 7 天未再次备份才提醒
  const days = Math.floor((Date.now() - state.lastBackupAt) / MS_PER_DAY);
  return { shouldRemind: days >= REMIND_INTERVAL_DAYS, days, neverBackedUp: false };
}

/**
 * 检查是否需要备份提醒（超过 7 天）
 */
export function shouldRemindBackup(): boolean {
  return getBackupReminder().shouldRemind;
}

/**
 * 用户点「稍后再说」后重新计时，避免每次冷启动都弹。
 */
export function snoozeBackupReminder(): void {
  localStorage.setItem(FIRST_REMINDER_KEY, Date.now().toString());
}

/**
 * 下载文本文件（内部工具）
 */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function bookTitleOf(books: Book[], bookId: string): string {
  return books.find(b => b.id === bookId)?.title || '未知书籍';
}

/**
 * 生成生词本文本（供导出与「复制全部」复用）
 * includeExamples=false 只导出单词；true 导出单词+例句
 */
export function buildVocabularyText(words: VocabularyWord[], books: Book[], includeExamples: boolean = false): string {
  const bookIds = Array.from(new Set(words.map(w => w.bookId)));
  const bookName = bookIds.length === 1 ? bookTitleOf(books, bookIds[0]) : '生词本';
  let text = `《${bookName}》生词\n导出时间：${new Date().toLocaleString()}\n${'='.repeat(40)}\n\n`;

  if (includeExamples) {
    words.forEach((w) => {
      text += `${w.word}`;
      if (w.context && w.context.trim()) text += `\n    ${w.context.trim()}`;
      text += `\n\n`;
    });
  } else {
    text += words.map(w => w.word).join('\n');
    text += '\n';
  }

  if (words.length === 0) text += `（暂无生词）\n`;
  return text;
}

/**
 * 导出生词本为 TXT
 */
export function exportVocabularyAsText(words: VocabularyWord[], books: Book[], includeExamples: boolean = false): void {
  const suffix = includeExamples ? '单词例句' : '单词';
  downloadText(`生词本_${suffix}_${new Date().toISOString().slice(0, 10)}.txt`, buildVocabularyText(words, books, includeExamples));
}

/**
 * 生成划线/想法文本（notesOnly=true 时只导出带想法的条目）
 */
export function buildHighlightsText(highlights: Highlight[], books: Book[], notesOnly: boolean): string {
  const list = (notesOnly ? highlights.filter(h => h.note && h.note.trim().length > 0) : highlights)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const label = notesOnly ? '想法' : '划线';
  let text = `${label}导出\n导出时间：${new Date().toLocaleString()}\n共 ${list.length} 条${label}\n${'='.repeat(40)}\n\n`;
  list.forEach((h, i) => {
    text += `[${i + 1}] ${h.text}\n`;
    if (h.note && h.note.trim()) text += `  想法：${h.note}\n`;
    text += `  来源：${bookTitleOf(books, h.bookId)}\n`;
    text += `  时间：${new Date(h.updatedAt).toLocaleString()}\n\n`;
  });
  if (list.length === 0) text += `（暂无${label}）\n`;
  return text;
}

/**
 * 导出划线/想法为 TXT
 */
export function exportHighlightsAsText(highlights: Highlight[], books: Book[], notesOnly: boolean): void {
  downloadText(`${notesOnly ? '想法' : '划线'}_${new Date().toISOString().slice(0, 10)}.txt`, buildHighlightsText(highlights, books, notesOnly));
}

/**
 * 生成 Markdown 格式的笔记（按书籍分组，可被各类笔记软件识别）
 * notesOnly=true 时只导出带想法的条目
 */
export function buildNotesMarkdown(highlights: Highlight[], books: Book[], notesOnly: boolean): string {
  const list = (notesOnly ? highlights.filter(h => h.note && h.note.trim().length > 0) : highlights)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const label = notesOnly ? '想法' : '笔记';
  const lines: string[] = [];
  lines.push(`# ${label}导出`);
  lines.push('');
  lines.push(`导出时间：${new Date().toLocaleString()}`);
  lines.push(`共 ${list.length} 条`);
  lines.push('');

  // 按书籍分组
  const byBook = new Map<string, Highlight[]>();
  for (const h of list) {
    const arr = byBook.get(h.bookId) || [];
    arr.push(h);
    byBook.set(h.bookId, arr);
  }

  for (const [bookId, items] of byBook) {
    lines.push(`## ${bookTitleOf(books, bookId)}`);
    lines.push('');
    items.forEach((h) => {
      // 引用块 + 想法
      lines.push(`> ${h.text.replace(/\n+/g, ' ').trim()}`);
      if (h.note && h.note.trim()) {
        lines.push(`>`);
        lines.push(`> 💭 ${h.note.trim()}`);
      }
      lines.push(`>`);
      lines.push(`> <sub>${new Date(h.updatedAt).toLocaleDateString()}</sub>`);
      lines.push('');
    });
    lines.push('---');
    lines.push('');
  }

  if (list.length === 0) lines.push(`（暂无${label}）`);
  return lines.join('\n');
}

/**
 * 导出划线/想法为 Markdown
 */
export function exportHighlightsAsMarkdown(highlights: Highlight[], books: Book[], notesOnly: boolean): void {
  const text = buildNotesMarkdown(highlights, books, notesOnly);
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${notesOnly ? '想法' : '笔记'}_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
