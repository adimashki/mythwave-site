// Makes a sql.js Database look like node:sqlite's DatabaseSync to src/core.js.

/** Wrap a sql.js Database so it looks like node:sqlite's DatabaseSync to the core. */
export function adapt(raw) {
  const clean = (args) => args.map((a) => (a === undefined ? null : a));
  const withStmt = (sql, fn) => {
    const st = raw.prepare(sql);
    try { return fn(st); } finally { st.free(); }
  };
  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => ({
      get: (...args) => withStmt(sql, (st) => { st.bind(clean(args)); return st.step() ? st.getAsObject() : undefined; }),
      all: (...args) => withStmt(sql, (st) => {
        st.bind(clean(args));
        const rows = [];
        while (st.step()) rows.push(st.getAsObject());
        return rows;
      }),
      run: (...args) => withStmt(sql, (st) => {
        st.run(clean(args));
        const changes = raw.getRowsModified();
        const lastInsertRowid = raw.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
        return { changes, lastInsertRowid };
      }),
    }),
  };
}
