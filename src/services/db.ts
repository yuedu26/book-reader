/**
 * IndexedDB 服务 —— 存储 EPUB 文件的 ArrayBuffer
 */

const DB_NAME = 'reader_pwa_db';
const DB_VERSION = 3; // 再次升级，强制重新创建
const STORE_NAME = 'epub_files';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
      console.error('[DB] Open failed:', req.error);
      reject(req.error);
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
