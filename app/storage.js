'use strict';

globalThis.MVStorage = {
  async transaction(mode, operation) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mv-studio-projects', 2);
      request.onupgradeneeded = event => {
        const store = event.oldVersion === 0
          ? request.result.createObjectStore('projects')
          : request.transaction.objectStore('projects');
        const legacy = store.get('current');
        legacy.onsuccess = () => {
          if (!legacy.result) return;
          store.put(legacy.result, 'legacy');
          store.delete('current');
        };
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('他のタブを閉じてから再試行してください'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', mode);
        const request = operation(transaction.objectStore('projects'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error || new Error('保存操作が中断されました'));
      });
    } finally {
      database.close();
    }
  },
};
