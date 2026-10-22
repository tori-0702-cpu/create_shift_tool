// 割当ロジック(DOM非依存)
// データ形式: st = { dates:['YYYY-MM-DD'], rows:[{id,label}], need:{'日|行':人数}, staff:[{id,name,max}],
//                    prefs:{'スタッフ|日|行':'want'|'no'}, assign:{'日|行':[スタッフid]} }
const Scheduler = (() => {
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };

  function dateRange(start, end) {
    const out = [];
    if (!start || !end) return out;
    const e = parse(end);
    for (let d = parse(start); d <= e && out.length < 62; d.setDate(d.getDate() + 1)) out.push(fmt(d));
    return out;
  }

  // 月曜始まりの週キー
  function weekKey(dateStr) {
    const d = parse(dateStr);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return fmt(d);
  }

  const key = (date, rowId) => `${date}|${rowId}`;
  const needOf = (st, date, rowId) => { const v = st.need[key(date, rowId)]; return v === undefined ? 1 : v; };
  const pref = (st, staffId, date, rowId) => st.prefs[`${staffId}|${date}|${rowId}`] || 'ok';
  // 枠ファイルと希望ファイルの対応確認に使う。必要人数は含めない(人数の変更で配布済みファイルが無効にならない)
  const frameKey = f => f.dates.join(',') + '|' + f.rows.map(r => r.id).join(',');

  // 同じ seed なら同じ乱数列になる
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cellsOf(st) {
    const out = [];
    st.dates.forEach(date => st.rows.forEach(row => {
      const need = needOf(st, date, row.id);
      if (need > 0) out.push({ date, row, need, wk: weekKey(date) });
    }));
    return out;
  }

  // 「入れない」と週の上限は厳守し、「入りたい」を優先、回数の少ない人を先に入れる。同順位は乱数
  function autoAssign(st, { seed = 1 } = {}) {
    const rnd = rng(seed);
    const assign = {};
    const total = {}, weekly = {};
    st.staff.forEach(s => { total[s.id] = 0; weekly[s.id] = {}; });

    const cells = cellsOf(st).map(c => ({
      ...c, r: rnd(),
      cand: st.staff.filter(s => pref(st, s.id, c.date, c.row.id) !== 'no').length
    }));
    cells.forEach(c => { assign[key(c.date, c.row.id)] = []; });
    // 候補が少ない枠から先に埋める
    cells.sort((a, b) => a.cand - b.cand || a.r - b.r);

    cells.forEach(({ date, row, need, wk }) => {
      const list = assign[key(date, row.id)];
      for (let n = 0; n < need; n++) {
        const pool = st.staff.filter(s => {
          if (list.includes(s.id)) return false;
          if (pref(st, s.id, date, row.id) === 'no') return false;
          if (s.max && (weekly[s.id][wk] || 0) >= s.max) return false;
          return true;
        }).map(s => ({ s, j: rnd(), w: pref(st, s.id, date, row.id) === 'want' ? 0 : 1 }));
        if (!pool.length) break;
        pool.sort((a, b) => a.w - b.w || total[a.s.id] - total[b.s.id] || a.j - b.j);
        const pick = pool[0].s;
        list.push(pick.id);
        total[pick.id]++;
        weekly[pick.id][wk] = (weekly[pick.id][wk] || 0) + 1;
      }
    });
    return assign;
  }

  // 案の良し悪しを見る指標
  function score(st) {
    let wantTotal = 0, wantHit = 0, short = 0;
    const count = {};
    st.staff.forEach(s => { count[s.id] = 0; });
    st.dates.forEach(date => st.rows.forEach(row => {
      const list = st.assign[key(date, row.id)] || [];
      short += Math.max(0, needOf(st, date, row.id) - list.length);
      list.forEach(id => { if (id in count) count[id]++; });
      st.staff.forEach(s => {
        if (pref(st, s.id, date, row.id) === 'want') { wantTotal++; if (list.includes(s.id)) wantHit++; }
      });
    }));
    const v = Object.values(count);
    return { wantTotal, wantHit, short, spread: v.length ? Math.max(...v) - Math.min(...v) : 0 };
  }

  // 警告を集める
  function check(st) {
    const name = id => (st.staff.find(s => s.id === id) || {}).name || '(削除済み)';
    const out = [];
    const weekly = {};
    st.dates.forEach(date => st.rows.forEach(row => {
      const need = needOf(st, date, row.id);
      const list = st.assign[key(date, row.id)] || [];
      const at = `${date} ${row.label}`;
      if (list.length < need) out.push({ type: 'short', date, rowId: row.id, text: `${at}: ${need - list.length}人不足` });
      if (list.length > need) out.push({ type: 'over', date, rowId: row.id, text: `${at}: ${list.length - need}人多い` });
      list.forEach(id => {
        if (pref(st, id, date, row.id) === 'no') out.push({ type: 'ng', date, rowId: row.id, text: `${at}: ${name(id)}さんは入れない時間です` });
        const wk = weekKey(date);
        weekly[id] = weekly[id] || {};
        weekly[id][wk] = (weekly[id][wk] || 0) + 1;
      });
    }));
    st.staff.forEach(s => {
      if (!s.max) return;
      Object.entries(weekly[s.id] || {}).forEach(([wk, n]) => {
        if (n > s.max) out.push({ type: 'max', text: `${s.name}さん: ${wk}の週が ${n}回(上限${s.max}回)` });
      });
    });
    return out;
  }

  // ---- 振り分けパターン数 ----
  // 数える対象: 必要人数ちょうどを満たし、「入れない」と週の上限を守る振り分け
  function comb(n, k) {
    if (k < 0 || k > n) return 0n;
    k = Math.min(k, n - k);
    let r = 1n;
    for (let i = 1; i <= k; i++) r = r * BigInt(n - k + i) / BigInt(i);
    return r;
  }

  const EXACT_AUTO_LIMIT = 10_000_000n;
  const EXACT_NODE_LIMIT = 30_000_000;
  const SAMPLES = 3000;

  // mode: 'auto'(小規模は厳密・それ以外は概算) | 'exact' | 'estimate'
  function countPatterns(st, { mode = 'auto', seed = 1 } = {}) {
    const cells = cellsOf(st).map(c => ({
      ...c, elig: st.staff.filter(s => pref(st, s.id, c.date, c.row.id) !== 'no').map(s => s.id)
    }));
    let ub = 1n;
    cells.forEach(c => { ub *= comb(c.elig.length, c.need); });
    if (ub === 0n) return { kind: 'exact', value: 0n, ub, infeasible: true };

    const cap = {};
    st.staff.forEach(s => { if (s.max) cap[s.id] = s.max; });
    if (!Object.keys(cap).length) return { kind: 'exact', value: ub, ub, noCap: true };

    const useExact = mode === 'exact' || (mode === 'auto' && ub <= EXACT_AUTO_LIMIT);
    if (useExact) {
      const wk = {};
      st.staff.forEach(s => { wk[s.id] = {}; });
      let count = 0n, nodes = 0, aborted = false;
      const go = ci => {
        if (aborted) return;
        if (++nodes > EXACT_NODE_LIMIT) { aborted = true; return; }
        if (ci === cells.length) { count++; return; }
        const c = cells[ci];
        const el = c.elig.filter(id => !cap[id] || (wk[id][c.wk] || 0) < cap[id]);
        const picked = [];
        const choose = (start, left) => {
          if (aborted) return;
          if (left === 0) {
            picked.forEach(id => { wk[id][c.wk] = (wk[id][c.wk] || 0) + 1; });
            go(ci + 1);
            picked.forEach(id => { wk[id][c.wk]--; });
            return;
          }
          for (let i = start; i <= el.length - left; i++) {
            picked.push(el[i]); choose(i + 1, left - 1); picked.pop();
          }
        };
        choose(0, c.need);
      };
      go(0);
      if (!aborted) return { kind: 'exact', value: count, ub };
      // 打ち切った場合は概算に切り替える
    }

    // 概算(Knuth法): 各枠を順に決め、週の上限を守れる人だけから無作為に選ぶ。
    // その時点の選び方の数(C(上限内の候補数, 必要数))の積を試行ごとに求め、その平均が推定値になる
    const rnd = rng(seed);
    let sum = 0n, hits = 0;
    for (let n = 0; n < SAMPLES; n++) {
      const wk = {};
      let w = 1n;
      for (const c of cells) {
        const a = c.elig.filter(id => !cap[id] || ((wk[id] || {})[c.wk] || 0) < cap[id]);
        w *= comb(a.length, c.need);
        if (w === 0n) break;
        for (let i = 0; i < c.need; i++) {
          const j = i + Math.floor(rnd() * (a.length - i));
          [a[i], a[j]] = [a[j], a[i]];
          wk[a[i]] = wk[a[i]] || {};
          wk[a[i]][c.wk] = (wk[a[i]][c.wk] || 0) + 1;
        }
      }
      if (w > 0n) { sum += w; hits++; }
    }
    const value = hits ? sum / BigInt(SAMPLES) : null;
    return { kind: 'estimate', value, ub, hits, samples: SAMPLES, forcedAborted: mode === 'exact' };
  }

  return { fmt, parse, addDays, dateRange, weekKey, key, needOf, pref, frameKey, autoAssign, score, check, countPatterns, comb };
})();
