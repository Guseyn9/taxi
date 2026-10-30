/** Structured-clone storage: no JSON parsing and no executable classes in persistent data. */
export interface GraphCache {
    read(key: string): Promise<any>;
    write(key: string, value: unknown): Promise<void>;
}
export function indexedGraphCache(): GraphCache {
    let opened: Promise<IDBDatabase> | undefined;
    const open = () => opened || (opened = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('Persistent graph cache unavailable'));
            return;
        }
        const req = indexedDB.open('taxi-road-graph-v1', 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('graphs'))
            req.result.createObjectStore('graphs'); };
        req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Graph cache blocked'));
    }));
    return {
        async read(key) { try {
            const db = await open();
            return await new Promise((resolve, reject) => { const req = db.transaction('graphs', 'readonly').objectStore('graphs').get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        }
        catch {
            return undefined;
        } },
        async write(key, value) { try {
            const db = await open();
            await new Promise<void>((resolve, reject) => { const tx = db.transaction('graphs', 'readwrite'); tx.objectStore('graphs').put(value, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
        }
        catch { /* Quota/private mode: calculations still work, only persistence is unavailable. */ } },
    };
}
