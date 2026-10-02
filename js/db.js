/* LeadFlow CRM - IndexedDB Database Layer */
const DB = (() => {
  const DB_NAME = 'LeadFlowCRM';
  // Minimum schema version we understand. Actual open version is
  // max(MIN_DB_VERSION, existing browser DB version) so older local
  // DBs never fail with "requested version is less than existing".
  const MIN_DB_VERSION = 5;
  let db = null;

  const STORES = {
    users: { keyPath: 'id', indexes: [
      { name: 'username', keyPath: 'username', unique: true },
      { name: 'role', keyPath: 'role' },
      { name: 'active', keyPath: 'active' }
    ]},
    leads: { keyPath: 'id', indexes: [
      { name: 'enquiryNo', keyPath: 'enquiryNo', unique: true },
      { name: 'status', keyPath: 'status' },
      { name: 'assignedTo', keyPath: 'assignedTo' },
      { name: 'createdBy', keyPath: 'createdBy' },
      { name: 'enquiryDate', keyPath: 'enquiryDate' },
      { name: 'mobile', keyPath: 'mobile' },
      { name: 'updatedAt', keyPath: 'updatedAt' }
    ]},
    payments: { keyPath: 'id', indexes: [
      { name: 'receiptNo', keyPath: 'receiptNo', unique: true },
      { name: 'leadId', keyPath: 'leadId' },
      { name: 'paymentDate', keyPath: 'paymentDate' }
    ]},
    followups: { keyPath: 'id', indexes: [
      { name: 'leadId', keyPath: 'leadId' },
      { name: 'status', keyPath: 'status' },
      { name: 'date', keyPath: 'date' },
      { name: 'nextFollowupDate', keyPath: 'nextFollowupDate' }
    ]},
    attachments: { keyPath: 'id', indexes: [
      { name: 'leadId', keyPath: 'leadId' },
      { name: 'paymentId', keyPath: 'paymentId' },
      { name: 'followupId', keyPath: 'followupId' }
    ]},
    statusHistory: { keyPath: 'id', indexes: [
      { name: 'leadId', keyPath: 'leadId' },
      { name: 'changedAt', keyPath: 'changedAt' }
    ]},
    activityLogs: { keyPath: 'id', indexes: [
      { name: 'leadId', keyPath: 'leadId' },
      { name: 'userId', keyPath: 'userId' },
      { name: 'action', keyPath: 'action' },
      { name: 'createdAt', keyPath: 'createdAt' }
    ]},
    notifications: { keyPath: 'id', indexes: [
      { name: 'userId', keyPath: 'userId' },
      { name: 'read', keyPath: 'read' },
      { name: 'eventKey', keyPath: 'eventKey', unique: false },
      { name: 'createdAt', keyPath: 'createdAt' }
    ]},
    settings: { keyPath: 'key' },
    counters: { keyPath: 'name' },
    loginActivity: { keyPath: 'id', indexes: [
      { name: 'userId', keyPath: 'userId' },
      { name: 'timestamp', keyPath: 'timestamp' }
    ]}
  };

  function ensureStores(database, transaction) {
    for (const [name, config] of Object.entries(STORES)) {
      let store = null;

      if (!database.objectStoreNames.contains(name)) {
        try {
          store = database.createObjectStore(name, { keyPath: config.keyPath });
        } catch (e) {
          console.warn('Could not create store', name, e);
          continue;
        }
      } else if (transaction) {
        try {
          store = transaction.objectStore(name);
        } catch (e) {
          console.warn('Could not access store', name, e);
          continue;
        }
      }

      if (store) {
        for (const idx of (config.indexes || [])) {
          try {
            if (!store.indexNames.contains(idx.name)) {
              store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
            }
          } catch (e) {
            // Index exists with different options — leave as-is
            console.warn('Index skipped:', name, idx.name, e.message);
          }
        }
      }
    }
  }

  function attachDbHandlers(database) {
    database.onerror = (e) => console.error('DB error:', e);
    database.onversionchange = () => {
      try { database.close(); } catch (_) {}
      if (db === database) db = null;
    };
  }

  function hasAllStores(database) {
    return Object.keys(STORES).every(name => database.objectStoreNames.contains(name));
  }

  function openAtVersion(version) {
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, version);
      } catch (e) {
        reject(e);
        return;
      }

      request.onerror = () => {
        reject(request.error || new Error('Failed to open database'));
      };

      request.onblocked = () => {
        reject(new Error('Database is locked by another tab or window. Please close all other LeadFlow CRM tabs and try again.'));
      };

      request.onupgradeneeded = (event) => {
        try {
          ensureStores(event.target.result, event.target.transaction);
        } catch (e) {
          console.error('Upgrade failed:', e);
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        attachDbHandlers(database);

        if (!hasAllStores(database)) {
          // Existing DB at a higher version with missing stores — bump once.
          const nextVersion = (database.version || version) + 1;
          try { database.close(); } catch (_) {}
          setTimeout(() => {
            openAtVersion(nextVersion).then(resolve).catch(reject);
          }, 120);
          return;
        }

        db = database;
        resolve(db);
      };
    });
  }

  // Find existing version WITHOUT creating the database.
  async function findExistingVersion() {
    if (typeof indexedDB.databases === 'function') {
      try {
        const list = await indexedDB.databases();
        const found = list.find(d => d.name === DB_NAME);
        if (found) return found.version || 0;
        return 0;
      } catch (_) { /* fall through */ }
    }

    // Fallback: open with no version (creates a new DB only if absent — handled by caller)
    return await new Promise((resolve) => {
      const probe = indexedDB.open(DB_NAME);
      probe.onsuccess = () => {
        const database = probe.result;
        const version = database.version || 0;
        const storesOk = hasAllStores(database);
        database.close();
        setTimeout(() => resolve(version || (storesOk ? 0 : 0)), 120);
      };
      probe.onerror = () => resolve(0);
      probe.onupgradeneeded = (event) => {
        // Brand-new database — build schema right here, keep version 1.
        try { ensureStores(event.target.result, event.target.transaction); }
        catch (e) { console.error('Initial upgrade failed:', e); }
      };
    });
  }

  async function open() {
    if (db) return db;
    if (!window.indexedDB) {
      throw new Error('IndexedDB is not supported in this browser. LeadFlow CRM requires IndexedDB (use Chrome, Edge, or Firefox).');
    }

    // Race against a watchdog so a blocked/hung open never leaves a white screen.
    const watchdog = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database open timed out. Close other LeadFlow CRM tabs and retry, or click Reset Database.')), 12000);
    });

    return await Promise.race([doOpen(), watchdog]);
  }

  async function doOpen() {
    let existingVersion = await findExistingVersion();

    // Fallback probe above may have created + upgraded a fresh DB at version 1.
    // Re-probe cheaply via databases() if available; otherwise opening at v1 again
    // simply succeeds with no upgrade.
    let attemptVersion = Math.max(MIN_DB_VERSION, existingVersion || 0);

    try {
      const database = await openAtVersion(attemptVersion);
      return database;
    } catch (err) {
      const msg = (err && err.message) || '';
      const errName = (err && err.name) || '';
      console.error('Open failed at version', attemptVersion, err);

      // If some even-higher version exists, open at that version + 1.
      if (/version/i.test(msg)) {
        const match = msg.match(/(\d+)/);
        if (match) {
          try {
            return await openAtVersion(Number(match[1]) + 1);
          } catch (e2) {
            console.error('Bump open failed', e2);
          }
        }
      }

      // Incompatible/foreign schema or corrupted upgrade — the database
      // cannot be migrated. Rebuild it fresh.
      if (/abort|constraint|internal|incompatible|already exists/i.test(msg) ||
          errName === 'AbortError' || errName === 'ConstraintError') {
        console.warn('Incompatible database detected — rebuilding fresh LeadFlowCRM database…');
        await deleteDatabase().catch(e => console.warn('Delete failed:', e));
        await new Promise(r => setTimeout(r, 300));
        return await openAtVersion(MIN_DB_VERSION);
      }

      throw err;
    }
  }

  function deleteDatabase() {
    return new Promise((resolve, reject) => {
      if (db) {
        try { db.close(); } catch (_) {}
        db = null;
      }
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Failed to delete database'));
      req.onblocked = () => {
        // Still resolve after a delay — other tabs may hold it
        setTimeout(resolve, 500);
      };
    });
  }

  function getDB() {
    if (!db) throw new Error('Database not initialized. Call DB.open() first.');
    return db;
  }

  function tx(storeNames, mode = 'readonly') {
    const database = getDB();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return database.transaction(names, mode);
  }

  function req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Database request failed'));
    });
  }

  async function get(storeName, id) {
    const t = tx(storeName);
    return req(t.objectStore(storeName).get(id));
  }

  async function getAll(storeName) {
    const t = tx(storeName);
    return req(t.objectStore(storeName).getAll());
  }

  async function getByIndex(storeName, indexName, value) {
    const t = tx(storeName);
    return req(t.objectStore(storeName).index(indexName).getAll(value));
  }

  async function getOneByIndex(storeName, indexName, value) {
    const t = tx(storeName);
    return req(t.objectStore(storeName).index(indexName).get(value));
  }

  async function put(storeName, record) {
    const t = tx(storeName, 'readwrite');
    await req(t.objectStore(storeName).put(record));
    return record;
  }

  async function add(storeName, record) {
    const t = tx(storeName, 'readwrite');
    await req(t.objectStore(storeName).add(record));
    return record;
  }

  async function remove(storeName, id) {
    const t = tx(storeName, 'readwrite');
    await req(t.objectStore(storeName).delete(id));
  }

  async function clear(storeName) {
    const t = tx(storeName, 'readwrite');
    await req(t.objectStore(storeName).clear());
  }

  async function count(storeName) {
    const t = tx(storeName);
    return req(t.objectStore(storeName).count());
  }

  async function bulkPut(storeName, records) {
    const t = tx(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    for (const r of records) {
      store.put(r);
    }
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(records);
      t.onerror = () => reject(t.error);
    });
  }

  async function getNextCounter(name, prefix, year) {
    const t = tx('counters', 'readwrite');
    const store = t.objectStore('counters');
    const key = year ? `${name}_${year}` : name;

    return new Promise((resolve, reject) => {
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        let counter = getReq.result;
        if (!counter) {
          counter = { name: key, value: 0, year: year || null };
        }
        counter.value += 1;
        const putReq = store.put(counter);
        putReq.onsuccess = () => {
          const num = String(counter.value).padStart(4, '0');
          const code = year ? `${prefix}-${year}-${num}` : `${prefix}-${num}`;
          resolve(code);
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async function getSetting(key, defaultValue = null) {
    const rec = await get('settings', key);
    return rec ? rec.value : defaultValue;
  }

  async function setSetting(key, value) {
    return put('settings', { key, value, updatedAt: Utils.now() });
  }

  async function exportAll() {
    const data = {};
    for (const name of Object.keys(STORES)) {
      data[name] = await getAll(name);
    }
    return data;
  }

  async function importAll(data, mode = 'replace') {
    const storeNames = Object.keys(STORES);
    if (mode === 'replace') {
      for (const name of storeNames) {
        if (data[name]) {
          await clear(name);
          if (data[name].length) await bulkPut(name, data[name]);
        }
      }
    } else {
      // Merge: put all records (overwrite by id)
      for (const name of storeNames) {
        if (data[name] && data[name].length) {
          await bulkPut(name, data[name]);
        }
      }
    }
  }

  async function deleteLeadCascade(leadId) {
    const storeNames = ['leads', 'payments', 'followups', 'attachments', 'statusHistory', 'activityLogs', 'notifications'];
    const t = tx(storeNames, 'readwrite');

    return new Promise((resolve, reject) => {
      try {
        t.objectStore('leads').delete(leadId);

        const payIdx = t.objectStore('payments').index('leadId');
        payIdx.openCursor(IDBKeyRange.only(leadId)).onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };

        const fuIdx = t.objectStore('followups').index('leadId');
        fuIdx.openCursor(IDBKeyRange.only(leadId)).onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };

        const attIdx = t.objectStore('attachments').index('leadId');
        attIdx.openCursor(IDBKeyRange.only(leadId)).onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };

        const shIdx = t.objectStore('statusHistory').index('leadId');
        shIdx.openCursor(IDBKeyRange.only(leadId)).onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };

        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  return {
    open, getDB, get, getAll, getByIndex, getOneByIndex,
    put, add, remove, clear, count, bulkPut,
    getNextCounter, getSetting, setSetting,
    exportAll, importAll, deleteLeadCascade, deleteDatabase,
    STORES, DB_NAME, MIN_DB_VERSION
  };
})();