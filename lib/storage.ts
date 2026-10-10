export type Chunk = { id: string; documentId: string; documentName: string; text: string; page?: number; embedding?: number[] };
export type DocumentRecord = { id: string; name: string; type: string; size: number; chunks: number; addedAt: number };
type Workspace = { documents: DocumentRecord[]; chunks: Chunk[] };
const DB_NAME = 'context-rag-workspace';
const STORE = 'workspace';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open workspace storage'));
  });
}
export async function loadWorkspace(): Promise<Workspace | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('default');
    request.onsuccess = () => resolve((request.result as Workspace | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Could not load workspace'));
  });
}
export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(workspace, 'default');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save workspace'));
  });
}
