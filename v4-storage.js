(() => {
  "use strict";

  const DB_NAME = "golf-round-logger-v4";
  const DB_VERSION = 1;
  const STORES = Object.freeze({
    courseDefinitions: "courseDefinitions",
    roundSessions: "roundSessions",
    playerProfiles: "playerProfiles",
    metadata: "metadata",
  });
  let databasePromise = null;

  function openDatabase() {
    if (!window.indexedDB) return Promise.reject(new Error("このブラウザではIndexedDBを利用できません。"));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORES.courseDefinitions)) {
          database.createObjectStore(STORES.courseDefinitions, { keyPath: "courseId" });
        }
        if (!database.objectStoreNames.contains(STORES.roundSessions)) {
          const store = database.createObjectStore(STORES.roundSessions, { keyPath: "roundId" });
          store.createIndex("courseId", "courseId", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("playDate", "playDate", { unique: false });
        }
        if (!database.objectStoreNames.contains(STORES.playerProfiles)) {
          database.createObjectStore(STORES.playerProfiles, { keyPath: "playerProfileId" });
        }
        if (!database.objectStoreNames.contains(STORES.metadata)) {
          database.createObjectStore(STORES.metadata, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error("別の画面でデータベースが使用中です。アプリを閉じて再度お試しください。"));
      };
    });
    return databasePromise;
  }

  async function transact(storeName, mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      let request;
      try {
        request = operation(store);
      } catch (error) {
        transaction.abort();
        reject(error);
        return;
      }
      if (request) {
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => reject(request.error ?? new Error("データ操作に失敗しました。"));
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("データの保存に失敗しました。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("データ操作が中断されました。"));
    });
  }

  const put = (storeName, value) => transact(storeName, "readwrite", (store) => store.put(value));
  const get = (storeName, key) => transact(storeName, "readonly", (store) => store.get(key));
  const getAll = (storeName) => transact(storeName, "readonly", (store) => store.getAll());

  async function putCourseDefinitions(definitions) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORES.courseDefinitions, "readwrite");
      const store = transaction.objectStore(STORES.courseDefinitions);
      definitions.forEach((definition) => store.put(definition));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("コース定義を保存できませんでした。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("コース定義の保存が中断されました。"));
    });
  }

  async function listRoundSessions() {
    const rounds = await getAll(STORES.roundSessions);
    return rounds.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }

  async function setMetadata(key, value) {
    return put(STORES.metadata, { key, value, updatedAt: new Date().toISOString() });
  }

  async function getMetadata(key) {
    return (await get(STORES.metadata, key))?.value ?? null;
  }

  window.GolfV4Storage = Object.freeze({
    schemaVersion: 4,
    databaseName: DB_NAME,
    stores: STORES,
    open: openDatabase,
    putCourseDefinitions,
    listCourseDefinitions: () => getAll(STORES.courseDefinitions),
    putRoundSession: (roundSession) => put(STORES.roundSessions, roundSession),
    getRoundSession: (roundId) => get(STORES.roundSessions, roundId),
    listRoundSessions,
    putPlayerProfile: (profile) => put(STORES.playerProfiles, profile),
    listPlayerProfiles: () => getAll(STORES.playerProfiles),
    setMetadata,
    getMetadata,
  });
})();
