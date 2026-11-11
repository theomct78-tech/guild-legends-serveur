'use strict';
/* Firestore en mémoire, suffisant pour tester les fonctions serveur hors ligne. */
let autoId = 0;
const SERVER_TS = { __serverTimestamp: true };

function createDb() {
  const store = new Map(); // chemin -> données

  class DocRef {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); }
    collection(name) { return new ColRef(`${this.path}/${name}`); }
    async get() { return snap(this.path); }
    async set(data) { store.set(this.path, clone(data)); }
    async delete() { store.delete(this.path); }
  }
  class ColRef {
    constructor(path) { this.path = path; }
    doc(id) { return new DocRef(`${this.path}/${id || 'auto' + (++autoId)}`); }
    async get() {
      const prefix = this.path + '/';
      const docs = [...store.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(k => snap(k));
      return { docs, size: docs.length };
    }
  }
  function snap(path) {
    const d = store.get(path);
    return { id: path.split('/').pop(), ref: new DocRef(path), exists: d !== undefined, data: () => clone(d) };
  }
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

  const db = {
    store,
    doc: (p) => new DocRef(p),
    collection: (p) => new ColRef(p),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => writes.push(() => store.set(ref.path, opts?.merge ? { ...(store.get(ref.path) || {}), ...clone(data) } : clone(data))),
        update: (ref, data) => writes.push(() => {
          if (!store.has(ref.path)) throw new Error(`update sur un document absent : ${ref.path}`);
          store.set(ref.path, { ...store.get(ref.path), ...clone(data) });
        }),
        delete: (ref) => writes.push(() => store.delete(ref.path)),
      };
      const result = await fn(tx); // une erreur annule toutes les écritures
      writes.forEach(w => w());
      return result;
    },
  };
  return db;
}

module.exports = { createDb, SERVER_TS };
