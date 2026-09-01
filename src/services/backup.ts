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

/**
 * 检查是否需要备份提醒（超过7天）
 */
export function shouldRemindBackup(): boolean {
  const state = useAppStore.getState();
  const lastBackup = state.lastBackupAt;
  
  // 首次使用，没有数据，不提醒
  if (state.books.length === 0) return false;
  
  // 从未备份过，但有数据，先记录当前时间作为"首次发现需要备份"的时间
  if (lastBackup === 0) {
    // 检查是否有"首次提醒时间"记录
    const firstReminderKey = 'reader_pwa_first_backup_reminder';
    const firstReminder = localStorage.getItem(firstReminderKey);
    
    if (!firstReminder) {
      // 首次发现有数据需要备份，记录时间但不提醒
      localStorage.setItem(firstReminderKey, Date.now().toString());
      return false;
    }
    
    // 已经记录过，检查是否超过7天
    const daysSinceFirstReminder = (Date.now() - parseInt(firstReminder)) / (1000 * 60 * 60 * 24);
    return daysSinceFirstReminder >= 7;
  }
  
  // 已经备份过，检查是否超过7天
  const daysSince = (Date.now() - lastBackup) / (1000 * 60 * 60 * 24);
  return daysSince >= 7;
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
 */
export function buildVocabularyText(words: VocabularyWord[], books: Book[]): string {
  let text = `生词本导出\n导出时间：${new Date().toLocaleString()}\n共 ${words.length} 个生词\n${'='.repeat(40)}\n\n`;
  words.forEach((w, i) => {
    text += `${i + 1}. ${w.word}\n`;
    text += `   来源：${bookTitleOf(books, w.bookId)}${w.chapterTitle ? ' · ' + w.chapterTitle : ''}\n`;
    if (w.context) text += `   上下文：${w.context}\n`;
    if (w.definition) text += `   释义：${w.definition}\n`;
    text += `   复习：${w.reviewCount} 次\n\n`;
  });
  if (words.length === 0) text += `（暂无生词）\n`;
  return text;
}

/**
 * 导出生词本为 TXT
 */
export function exportVocabularyAsText(words: VocabularyWord[], books: Book[]): void {
  downloadText(`生词本_${new Date().toISOString().slice(0, 10)}.txt`, buildVocabularyText(words, books));
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
