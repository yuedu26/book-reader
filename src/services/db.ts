/**
 * IndexedDB 服务 —— 存储 EPUB 文件的 ArrayBuffer
 */

const DB_NAME = 'reader_pwa_db';
const DB_VERSION = 3; // 再次升级，强制重新创建
const STORE_NAME = 'epub_files';

// 检测是否在 standalone 模式（添加到主屏幕）
function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || 
         (window.navigator as any).standalone === true;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // 检查 IndexedDB 是否可用
    if (!window.indexedDB) {
      const errorMsg = 'IndexedDB 不可用，请检查浏览器设置或尝试在普通浏览器中打开';
      console.error('[DB]', errorMsg, 'Standalone:', isStandalone());
      reject(new Error(errorMsg));
      return;
    }

    console.log('[DB] Opening database...', 'Standalone:', isStandalone());
    
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    
    req.onupgradeneeded = (event) => {
      const db = req.result;
      console.log('[DB] onupgradeneeded, old version:', event.oldVersion, 'new version:', event.newVersion);
      
      // 删除旧的 object store（如果存在）
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      
      // 创建新的 object store
      db.createObjectStore(STORE_NAME);
      console.log('[DB] Object store created');
    };
    
    req.onsuccess = () => {
      const db = req.result;
      console.log('[DB] Opened successfully, stores:', Array.from(db.objectStoreNames));
      resolve(db);
    };
    
    req.onerror = () => {
      console.error('[DB] Open failed:', req.error, 'Standalone:', isStandalone());
      reject(new Error(`IndexedDB 打开失败：${req.error?.message || '未知错误'}。如果是 standalone 模式，请尝试在 Safari 中打开`));
    };
    
    req.onblocked = () => {
      console.error('[DB] Open blocked, please close other tabs');
      reject(new Error('数据库被占用，请关闭其他标签页后重试'));
    };
  });
}

export async function saveEpubFile(bookId: string, data: ArrayBuffer): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getEpubFile(bookId: string): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(bookId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEpubFile(bookId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
