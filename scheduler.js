// 割当ロジック(DOM非依存)
const Scheduler = (() => {
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

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

  const pref = (st, staffId, date, slotId) => st.prefs[`${staffId}|${date}|${slotId}`] || 'ok';
  const key = (date, slotId) => `${date}|${slotId}`;

  // 「入れない」を厳守し、「入りたい」を優先、回数が少ない人から割り当てる
  function autoAssign(st) {
    const dates = dateRange(st.start, st.end);
    const assign = {};
    const total = {}, weekly = {};
    st.staff.forEach(s => { total[s.id] = 0; weekly[s.id] = {}; });

    const cells = [];
    dates.forEach(date => st.slots.forEach(slot => {
      const cand = st.staff.filter(s => pref(st, s.id, date, slot.id) !== 'no');
      cells.push({ date, slot, cand: cand.length });
      assign[key(date, slot.id)] = [];
    }));
    // 候補が少ない枠から先に埋める
    cells.sort((a, b) => a.cand - b.cand || a.date.localeCompare(b.date));

    cells.forEach(({ date, slot }) => {
      const wk = weekKey(date);
      const list = assign[key(date, slot.id)];
      for (let n = 0; n < slot.need; n++) {
        const pool = st.staff.filter(s => {
          if (list.includes(s.id)) return false;
          if (pref(st, s.id, date, slot.id) === 'no') return false;
          if (s.max && (weekly[s.id][wk] || 0) >= s.max) return false;
          return true;
        });
        if (!pool.length) break;
        pool.sort((a, b) => {
          const wa = pref(st, a.id, date, slot.id) === 'want' ? 0 : 1;
          const wb = pref(st, b.id, date, slot.id) === 'want' ? 0 : 1;
          return wa - wb || total[a.id] - total[b.id];
        });
        const pick = pool[0];
        list.push(pick.id);
        total[pick.id]++;
        weekly[pick.id][wk] = (weekly[pick.id][wk] || 0) + 1;
      }
    });
    return assign;
  }

  // 警告を集める
  function check(st) {
    const dates = dateRange(st.start, st.end);
    const name = id => (st.staff.find(s => s.id === id) || {}).name || '(削除済み)';
    const out = [];
    const weekly = {};
    dates.forEach(date => st.slots.forEach(slot => {
      const list = st.assign[key(date, slot.id)] || [];
      if (list.length < slot.need) out.push({ type: 'short', date, slotId: slot.id, text: `${date} ${slot.label}: ${slot.need - list.length}人不足` });
      if (list.length > slot.need) out.push({ type: 'over', date, slotId: slot.id, text: `${date} ${slot.label}: ${list.length - slot.need}人多い` });
      list.forEach(id => {
        if (pref(st, id, date, slot.id) === 'no') out.push({ type: 'ng', date, slotId: slot.id, text: `${date} ${slot.label}: ${name(id)}さんは入れない時間です` });
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

  return { dateRange, autoAssign, check, pref, key, parse };
})();
