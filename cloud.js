(() => {
  'use strict';

  const QUEUE_KEY = 'personal-workbench-sync-queue-v1';
  const MIGRATION_PREFIX = 'personal-workbench-cloud-migrated-v1:';
  const COLLECTION_TO_TYPE = {
    tasks: 'task',
    notes: 'note',
    events: 'event',
    resources: 'resource'
  };
  const TYPE_TO_COLLECTION = Object.fromEntries(
    Object.entries(COLLECTION_TO_TYPE).map(([collection, type]) => [type, collection])
  );

  let client = null;
  let session = null;
  let callbacks = {};
  let syncTimer = null;
  let pollTimer = null;
  let syncing = false;
  let status = {
    code: 'local',
    label: '本地模式',
    detail: '登录后启用云端同步',
    session: null
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
  }

  async function withTimeout(promise, timeoutMs = 8000) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('网络连接超时')), timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function readQueue() {
    try {
      const value = JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function queueSize() {
    return Object.keys(readQueue()).length;
  }

  function setStatus(code, label, detail = '') {
    status = { code, label, detail, session };
    callbacks.onStatus?.(clone(status));
  }

  function scheduleSync(delay = 900) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(), delay);
  }

  function queueOperation(collection, item, deletedAt = null) {
    if (!COLLECTION_TO_TYPE[collection] || !item?.id) return;
    const queue = readQueue();
    const updatedAt = deletedAt || item.updatedAt || now();
    const key = `${collection}:${item.id}`;
    queue[key] = {
      collection,
      id: item.id,
      item: deletedAt ? null : clone({ ...item, updatedAt }),
      updatedAt,
      deletedAt
    };
    writeQueue(queue);
    setStatus(
      session ? 'pending' : 'local',
      session ? '等待同步' : '仅本地',
      session ? `${queueSize()} 项修改等待上传` : '登录后自动上传本机数据'
    );
    if (session) scheduleSync();
  }

  function queueUpsert(collection, item) {
    queueOperation(collection, item);
  }

  function queueDelete(collection, id, deletedAt = now()) {
    queueOperation(collection, { id, updatedAt: deletedAt }, deletedAt);
  }

  function queueAll(data = callbacks.getData?.()) {
    if (!data) return;
    Object.keys(COLLECTION_TO_TYPE).forEach(collection => {
      (data[collection] || []).forEach(item => queueUpsert(collection, item));
    });
  }

  function migratedKey() {
    return session?.user?.id ? `${MIGRATION_PREFIX}${session.user.id}` : '';
  }

  function hasMigrated() {
    const key = migratedKey();
    return key ? localStorage.getItem(key) === '1' : false;
  }

  function markMigrated() {
    const key = migratedKey();
    if (key) localStorage.setItem(key, '1');
  }

  async function flushQueue() {
    const queue = readQueue();
    const operations = Object.values(queue);
    if (!operations.length) return;

    const rows = operations.map(operation => ({
      user_id: session.user.id,
      id: operation.id,
      entity_type: COLLECTION_TO_TYPE[operation.collection],
      payload: operation.deletedAt ? {} : operation.item,
      updated_at: operation.updatedAt,
      deleted_at: operation.deletedAt
    }));

    const { error } = await withTimeout(
      client.from('workbench_items').upsert(rows, { onConflict: 'user_id,id' }),
      10000
    );
    if (error) throw error;

    const latestQueue = readQueue();
    operations.forEach(operation => {
      const key = `${operation.collection}:${operation.id}`;
      if (latestQueue[key]?.updatedAt === operation.updatedAt) delete latestQueue[key];
    });
    writeQueue(latestQueue);
  }

  function itemTime(item) {
    const time = Date.parse(item?.updatedAt || item?.createdAt || 0);
    return Number.isFinite(time) ? time : 0;
  }

  async function pullRemote() {
    const { data: rows, error } = await withTimeout(
      client
        .from('workbench_items')
        .select('id,entity_type,payload,updated_at,deleted_at')
        .order('updated_at', { ascending: true }),
      10000
    );
    if (error) throw error;

    const local = clone(callbacks.getData?.() || {});
    Object.keys(COLLECTION_TO_TYPE).forEach(collection => {
      if (!Array.isArray(local[collection])) local[collection] = [];
    });

    const pending = readQueue();

    (rows || []).forEach(row => {
      const collection = TYPE_TO_COLLECTION[row.entity_type];
      if (!collection) return;
      const key = `${collection}:${row.id}`;
      const operation = pending[key];
      const index = local[collection].findIndex(item => item.id === row.id);
      const localItem = index >= 0 ? local[collection][index] : null;
      const remoteTime = Date.parse(row.updated_at || row.deleted_at || 0) || 0;

      if (operation) {
        const pendingTime = Date.parse(operation.updatedAt || 0) || 0;
        if (pendingTime >= remoteTime) {
          if (operation.deletedAt) {
            if (index >= 0) local[collection].splice(index, 1);
          } else if (index < 0) {
            local[collection].push(clone(operation.item));
          }
          return;
        }
        delete pending[key];
      }

      if (row.deleted_at) {
        if (!localItem || remoteTime >= itemTime(localItem)) {
          if (index >= 0) local[collection].splice(index, 1);
        } else {
          const updatedAt = localItem.updatedAt || now();
          pending[key] = {
            collection,
            id: localItem.id,
            item: clone({ ...localItem, updatedAt }),
            updatedAt,
            deletedAt: null
          };
        }
        return;
      }

      const remoteItem = {
        ...(row.payload || {}),
        id: row.id,
        updatedAt: row.updated_at
      };
      if (!localItem) {
        local[collection].push(remoteItem);
      } else if (remoteTime > itemTime(localItem)) {
        local[collection][index] = remoteItem;
      } else if (remoteTime < itemTime(localItem)) {
        const updatedAt = localItem.updatedAt || now();
        pending[key] = {
          collection,
          id: localItem.id,
          item: clone({ ...localItem, updatedAt }),
          updatedAt,
          deletedAt: null
        };
      }
    });

    writeQueue(pending);
    callbacks.setData?.(local);
  }

  async function syncNow({ quiet = true } = {}) {
    if (!client || !session) {
      setStatus('local', '仅本地', '登录后启用云端同步');
      if (!quiet) callbacks.toast?.('请先登录云端账号');
      return false;
    }
    if (!navigator.onLine) {
      setStatus('pending', '等待网络', `${queueSize()} 项修改保存在本机`);
      return false;
    }
    if (syncing) return false;

    syncing = true;
    setStatus('syncing', '同步中', '正在连接新加坡云端');
    try {
      if (!hasMigrated()) queueAll();
      await pullRemote();
      await flushQueue();
      await pullRemote();
      markMigrated();
      const remaining = queueSize();
      if (remaining) {
        setStatus('pending', '等待同步', `${remaining} 项修改等待上传`);
      } else {
        setStatus('synced', '已同步', `上次同步 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
      }
      if (!quiet) callbacks.toast?.('云端同步完成');
      return true;
    } catch (error) {
      console.warn('云端同步暂不可用：', error);
      setStatus('pending', '等待同步', `${queueSize()} 项修改已安全保存在本机`);
      if (!quiet) callbacks.toast?.('云端暂不可用，修改已保存在本机');
      return false;
    } finally {
      syncing = false;
    }
  }

  async function activateSession(nextSession) {
    session = nextSession;
    if (!session) {
      clearInterval(pollTimer);
      pollTimer = null;
      setStatus('local', '仅本地', '登录后启用云端同步');
      return;
    }
    setStatus('pending', '准备同步', session.user.email || '已登录');
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') syncNow();
    }, 60000);
    await syncNow();
  }

  async function init(nextCallbacks) {
    callbacks = nextCallbacks || {};
    const config = window.WORKBENCH_CONFIG || {};
    if (!window.supabase?.createClient || !config.supabaseUrl || !config.supabasePublishableKey) {
      setStatus('local', '仅本地', '云端组件未加载，本机功能不受影响');
      return;
    }

    client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    client.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.user?.id !== session?.user?.id) activateSession(nextSession);
      else {
        session = nextSession;
        callbacks.onStatus?.(clone({ ...status, session }));
      }
    });

    try {
      const { data, error } = await withTimeout(client.auth.getSession(), 7000);
      if (error) throw error;
      await activateSession(data.session);
    } catch (error) {
      console.warn('无法连接云端认证：', error);
      setStatus('local', '仅本地', '公司网络暂时无法连接云端');
    }

    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => {
      setStatus('pending', '等待网络', `${queueSize()} 项修改保存在本机`);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow();
    });
  }

  async function signIn(email, password) {
    if (!client) throw new Error('云端组件未加载');
    const { data, error } = await withTimeout(
      client.auth.signInWithPassword({ email, password }),
      12000
    );
    if (error) throw error;
    await activateSession(data.session);
    return data;
  }

  async function signUp(email, password) {
    if (!client) throw new Error('云端组件未加载');
    const { data, error } = await withTimeout(
      client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: 'https://jiqi8716.github.io/personal-workbench/'
        }
      }),
      12000
    );
    if (error) throw error;
    if (data.session) await activateSession(data.session);
    return data;
  }

  async function signOut() {
    if (client) {
      const { error } = await withTimeout(client.auth.signOut(), 7000);
      if (error) throw error;
    }
    await activateSession(null);
  }

  window.WorkbenchCloud = {
    init,
    queueUpsert,
    queueDelete,
    queueAll,
    syncNow,
    signIn,
    signUp,
    signOut,
    getStatus: () => clone(status),
    getSession: () => clone(session)
  };
})();
