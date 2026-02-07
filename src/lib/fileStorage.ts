// ============================================================================
// IndexedDB File Storage for Upload Resilience
// Stores actual PDF File blobs so they survive page refresh and can be retried
// ============================================================================

const DB_NAME = "admin_upload_files";
const DB_VERSION = 1;
const STORE_NAME = "pdf_files";

interface StoredFile {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileBlob: Blob;
  documentType: string;
  storedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "fileId" });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store a File blob in IndexedDB for later retry
 */
export async function storeFile(
  fileId: string, 
  file: File, 
  documentType: string
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    
    const entry: StoredFile = {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileBlob: file,
      documentType,
      storedAt: Date.now(),
    };
    
    store.put(entry);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("[FileStorage] Failed to store file:", err);
  }
}

/**
 * Retrieve a stored File blob from IndexedDB
 */
export async function getStoredFile(fileId: string): Promise<File | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(fileId);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        const entry = request.result as StoredFile | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        // Reconstruct a File from the stored Blob
        const file = new File([entry.fileBlob], entry.fileName, {
          type: "application/pdf",
        });
        resolve(file);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn("[FileStorage] Failed to get file:", err);
    return null;
  }
}

/**
 * Remove a stored file from IndexedDB (call after successful processing)
 */
export async function removeStoredFile(fileId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(fileId);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("[FileStorage] Failed to remove file:", err);
  }
}

/**
 * Remove multiple stored files
 */
export async function removeStoredFiles(fileIds: string[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    
    for (const id of fileIds) {
      store.delete(id);
    }
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("[FileStorage] Failed to remove files:", err);
  }
}

/**
 * Clear all stored files (call when user clears upload history)
 */
export async function clearAllStoredFiles(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("[FileStorage] Failed to clear files:", err);
  }
}

/**
 * Get count of stored files
 */
export async function getStoredFileCount(): Promise<number> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn("[FileStorage] Failed to count files:", err);
    return 0;
  }
}

/**
 * Clean up old stored files (older than 24 hours)
 */
export async function cleanupOldFiles(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const entries = request.result as StoredFile[];
        const now = Date.now();
        let cleaned = 0;
        
        for (const entry of entries) {
          if (now - entry.storedAt > maxAgeMs) {
            store.delete(entry.fileId);
            cleaned++;
          }
        }
        
        tx.oncomplete = () => {
          db.close();
          resolve(cleaned);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn("[FileStorage] Failed to cleanup files:", err);
    return 0;
  }
}
