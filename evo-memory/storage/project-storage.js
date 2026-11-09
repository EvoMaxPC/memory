// Almacenamiento persistente de proyectos (Capa 1): persiste en el navegador (chrome/browser
// storage.local), migra el estado anterior sin perder datos y guarda historial versionado.
// El backend es intercambiable: en Node se usa uno en memoria para probar persistencia real
// (guardar → crear otra instancia → recuperar). Se prueba con: node tests/capa1.test.js
(function (root) {
  const EVO = (root.EVO = root.EVO || {});
  const KEY = 'evo_state_v1'; // misma clave que ya usaba la extensión: no se pierde nada guardado
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const engine = () => EVO.ObjectiveEngine;

  function createProjectData(name, now) {
    return {
      name, objective: '', nextStep: '', decisions: [], rules: [], failed: [],
      seen: {}, convs: {}, errFp: {}, code: [], alerts: [],
      protectedData: engine().createProtectedData(now), history: []
    };
  }

  // Migra un proyecto de la v0.1.x: conserva objetivo/decisiones/etc. y crea la zona protegida.
  // Si ya había un objetivo escrito, pasa a ser el objetivo protegido v1 (registrado en historial).
  function migrateProject(p, now) {
    const base = createProjectData(p.name || 'Proyecto', now);
    const hadProtected = !!(p && p.protectedData);
    const out = Object.assign(base, clone(p));
    if (!hadProtected) {
      out.protectedData = engine().createProtectedData(now); out.history = out.history || [];
      if ((p.objective || '').trim()) {
        const r = engine().applyProtectedChange(out, { field: 'objective', action: 'set', value: p.objective }, { actor: 'user', confirmed: true, now });
        if (r.ok) { out.protectedData = r.project.protectedData; out.history = r.project.history; out.history[0].action = 'set (migración desde v0.1)'; }
      }
    }
    out.history = out.history || [];
    return out;
  }
  const defaultState = (now) => ({ active: 'default', projects: { default: createProjectData('Proyecto 1', now) } });
  function migrateState(s, now) {
    if (!s || !s.projects) return defaultState(now);
    const out = { active: s.active, projects: {} };
    for (const [id, p] of Object.entries(s.projects)) out.projects[id] = migrateProject(p, now);
    if (!out.projects[out.active]) out.active = Object.keys(out.projects)[0];
    return out;
  }

  // Backend en memoria con clonado JSON en cada operación: simula el guardado real del navegador.
  function createMemoryBackend() {
    let data = {};
    return {
      async get(key) { return key in data ? { [key]: clone(data[key]) } : {}; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = clone(v); },
      _dump: () => clone(data)
    };
  }
  // Backend real de la extensión (promesas: Chrome MV3 y Firefox las devuelven).
  function createExtensionBackend(api) {
    return {
      get: (key) => api.storage.local.get(key),
      set: (obj) => api.storage.local.set(obj)
    };
  }

  function createStore(backend) {
    return {
      async loadState(now) {
        const r = await backend.get(KEY);
        return migrateState(r[KEY], now);
      },
      async saveState(state) { await backend.set({ [KEY]: state }); },
      async createProject(state, name, now) {
        const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        state.projects[id] = createProjectData(name, now); state.active = id;
        await this.saveState(state);
        return id;
      },
      // Único camino para tocar datos protegidos: pasa por el motor (actor + confirmación).
      // Si el motor rechaza, NO se guarda nada.
      async applyProtectedChange(state, projectId, change, opts) {
        const project = state.projects[projectId];
        if (!project) return { ok: false, code: 'SIN_PROYECTO', error: 'Proyecto no encontrado.' };
        const r = engine().applyProtectedChange(project, change, opts);
        if (!r.ok) return r;
        state.projects[projectId] = r.project;
        await this.saveState(state);
        return r;
      }
    };
  }

  EVO.ProjectStorage = { KEY, createProjectData, migrateProject, migrateState, defaultState, createMemoryBackend, createExtensionBackend, createStore };
})(globalThis);
