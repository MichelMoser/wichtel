// Datenspeicher: Firebase Firestore (echt, geteilt) oder localStorage (Demo, nur dieser Browser).
// Eine Wichtelrunde = ein Dokument in der Collection "wichtel".

const FB = 'https://www.gstatic.com/firebasejs/10.14.1';

export async function openStore(firebaseConfig) {
  return firebaseConfig ? firestoreStore(firebaseConfig) : localStore();
}

async function firestoreStore(cfg) {
  const { initializeApp } = await import(`${FB}/firebase-app.js`);
  const fs = await import(`${FB}/firebase-firestore.js`);
  const db = fs.getFirestore(initializeApp(cfg));
  const ref = (gid) => fs.doc(db, 'wichtel', gid);
  return {
    demo: false,
    DEL: fs.deleteField(),
    async create(gid, data) {
      await fs.runTransaction(db, async (tx) => {
        if ((await tx.get(ref(gid))).exists()) throw new Error('exists');
        tx.set(ref(gid), data);
      });
    },
    update: (gid, patch) => fs.updateDoc(ref(gid), patch),
    watch(gid, cb) {
      return fs.onSnapshot(ref(gid), (s) => cb(s.exists() ? s.data() : null), (err) => cb(null, err));
    },
  };
}

function localStore() {
  const DEL = Symbol('delete');
  const key = (gid) => `wichtel-demo:${gid}`;
  const listeners = new Map();
  const read = (gid) => {
    try { return JSON.parse(localStorage.getItem(key(gid))); } catch { return null; }
  };
  const write = (gid, data) => {
    localStorage.setItem(key(gid), JSON.stringify(data));
    (listeners.get(gid) || []).forEach((cb) => cb(structuredClone(data)));
  };
  window.addEventListener('storage', (e) => {
    const gid = e.key?.startsWith('wichtel-demo:') && e.key.slice(13);
    if (gid && listeners.has(gid)) listeners.get(gid).forEach((cb) => cb(read(gid)));
  });
  return {
    demo: true,
    DEL,
    async create(gid, data) {
      if (read(gid)) throw new Error('exists');
      write(gid, data);
    },
    async update(gid, patch) {
      const data = read(gid);
      if (!data) throw new Error('not-found');
      for (const [path, val] of Object.entries(patch)) {
        const parts = path.split('.');
        let o = data;
        for (const p of parts.slice(0, -1)) o = o[p] ??= {};
        if (val === DEL) delete o[parts.at(-1)];
        else o[parts.at(-1)] = structuredClone(val);
      }
      write(gid, data);
    },
    watch(gid, cb) {
      if (!listeners.has(gid)) listeners.set(gid, []);
      listeners.get(gid).push(cb);
      queueMicrotask(() => cb(read(gid)));
      return () => listeners.set(gid, listeners.get(gid).filter((f) => f !== cb));
    },
  };
}
