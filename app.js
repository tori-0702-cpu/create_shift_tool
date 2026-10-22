(() => {
  const { dateRange, autoAssign, check, pref, key, parse } = Scheduler;
  const $ = id => document.getElementById(id);
  const STORE = 'shift-tool-v1';
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const uid = () => Math.random().toString(36).slice(2, 9);

  let st = load() || blank();
  let curStaff = null;

  function blank() {
    const today = new Date();
    const mon = new Date(today); mon.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const f = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      start: f(mon), end: f(sun),
      slots: [{ id: uid(), label: '9:00-13:00', need: 2 }, { id: uid(), label: '13:00-17:00', need: 2 }],
      staff: [], prefs: {}, assign: {}
    };
  }
  function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* 保存できない環境では無視 */ } }

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    });
    kids.flat().forEach(k => e.append(k));
    return e;
  }
  const dayLabel = d => { const p = parse(d); return `${p.getMonth() + 1}/${p.getDate()}`; };
  const wdOf = d => WD[parse(d).getDay()];
  const staffName = id => (st.staff.find(s => s.id === id) || { name: '(削除済み)' }).name;

  // ---- タブ ----
  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    ['setup', 'prefs', 'board'].forEach(t => { $('tab-' + t).hidden = t !== name; });
    render();
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---- 設定 ----
  function renderSetup() {
    $('start').value = st.start; $('end').value = st.end;
    const sl = $('slot-list'); sl.replaceChildren();
    st.slots.forEach(slot => {
      sl.append(el('li', {},
        el('label', { class: 'grow' }, '枠の名前', el('input', { type: 'text', value: slot.label, maxlength: 20, oninput: e => { slot.label = e.target.value; save(); } })),
        el('label', {}, '必要人数', el('input', { type: 'number', min: 1, max: 30, value: slot.need, oninput: e => { slot.need = Math.max(1, +e.target.value || 1); save(); } })),
        el('button', { class: 'del', title: '削除', 'aria-label': `${slot.label}を削除`, onclick: () => {
          if (st.slots.length <= 1) return alert('枠は1つ以上必要です。');
          st.slots = st.slots.filter(s => s !== slot); save(); render();
        } }, '削除')));
    });
    const fl = $('staff-list'); fl.replaceChildren();
    if (!st.staff.length) fl.append(el('li', { class: 'empty' }, 'まだスタッフがいません。下のフォームから追加してください。'));
    st.staff.forEach(s => {
      fl.append(el('li', {},
        el('label', { class: 'grow' }, '名前', el('input', { type: 'text', value: s.name, maxlength: 20, oninput: e => { s.name = e.target.value; save(); } })),
        el('label', {}, '週の上限', el('input', { type: 'number', min: 1, max: 21, value: s.max || '', placeholder: 'なし', oninput: e => { s.max = +e.target.value || 0; save(); } })),
        el('button', { class: 'del', 'aria-label': `${s.name}を削除`, onclick: () => {
          if (!confirm(`${s.name}さんを削除しますか?希望と割り当ても消えます。`)) return;
          st.staff = st.staff.filter(x => x !== s);
          Object.keys(st.assign).forEach(k => { st.assign[k] = st.assign[k].filter(i => i !== s.id); });
          Object.keys(st.prefs).forEach(k => { if (k.startsWith(s.id + '|')) delete st.prefs[k]; });
          save(); render();
        } }, '削除')));
    });
  }
  $('start').addEventListener('change', e => { st.start = e.target.value; if (st.end < st.start) st.end = st.start; save(); renderSetup(); });
  $('end').addEventListener('change', e => { st.end = e.target.value; if (st.end < st.start) st.start = st.end; save(); renderSetup(); });
  $('add-slot').addEventListener('click', () => { st.slots.push({ id: uid(), label: '新しい枠', need: 1 }); save(); renderSetup(); });
  $('staff-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('staff-name').value.trim();
    if (!name) return;
    st.staff.push({ id: uid(), name, max: +$('staff-max').value || 0 });
    $('staff-name').value = ''; $('staff-max').value = '';
    save(); renderSetup(); $('staff-name').focus();
  });

  // ---- 希望入力 ----
  const NEXT = { ok: 'want', want: 'no', no: 'ok' };
  const LABEL = { ok: '', want: '入りたい', no: '入れない' };
  function renderPrefs() {
    const sel = $('pref-staff'); sel.replaceChildren();
    st.staff.forEach(s => sel.append(el('option', { value: s.id }, s.name)));
    if (!st.staff.some(s => s.id === curStaff)) curStaff = st.staff[0] && st.staff[0].id;
    sel.value = curStaff || '';
    const wrap = $('pref-grid'); wrap.replaceChildren();
    if (!curStaff) { wrap.append(el('p', { class: 'empty' }, '先にスタッフを追加してください。')); return; }
    const dates = dateRange(st.start, st.end);
    const table = el('table', { class: 'grid' });
    table.append(el('thead', {}, el('tr', {}, el('th', {}, '日付'), st.slots.map(s => el('th', {}, s.label)))));
    const tb = el('tbody');
    dates.forEach(d => {
      const wd = parse(d).getDay();
      const tr = el('tr', { class: wd === 0 ? 'sun' : wd === 6 ? 'sat' : '' });
      tr.append(el('th', { scope: 'row' }, el('button', { class: 'daybtn', title: 'この日を終日「入れない」にする/戻す', onclick: () => {
        const allNo = st.slots.every(s => pref(st, curStaff, d, s.id) === 'no');
        st.slots.forEach(s => setPref(curStaff, d, s.id, allNo ? 'ok' : 'no'));
        save(); renderPrefs();
      } }, `${dayLabel(d)}(${wdOf(d)})`)));
      st.slots.forEach(s => {
        const v = pref(st, curStaff, d, s.id);
        tr.append(el('td', {}, el('button', { class: 'cell p-' + v, 'aria-label': `${dayLabel(d)} ${s.label} ${LABEL[v] || '入れる'}`, onclick: () => {
          setPref(curStaff, d, s.id, NEXT[pref(st, curStaff, d, s.id)]); save(); renderPrefs();
        } }, LABEL[v])));
      });
      tb.append(tr);
    });
    table.append(tb); wrap.append(table);
  }
  function setPref(sid, d, slotId, v) {
    const k = `${sid}|${d}|${slotId}`;
    if (v === 'ok') delete st.prefs[k]; else st.prefs[k] = v;
  }
  $('pref-staff').addEventListener('change', e => { curStaff = e.target.value; renderPrefs(); });

  // ---- シフト表 ----
  function renderBoard() {
    const warns = check(st);
    const bad = new Set(warns.filter(w => w.date).map(w => key(w.date, w.slotId)));
    const wrap = $('board-grid'); wrap.replaceChildren();
    const dates = dateRange(st.start, st.end);
    const table = el('table', { class: 'grid board' });
    table.append(el('thead', {}, el('tr', {}, el('th', {}, '日付'), st.slots.map(s => el('th', {}, s.label, el('small', {}, `必要${s.need}人`))))));
    const tb = el('tbody');
    dates.forEach(d => {
      const wd = parse(d).getDay();
      const tr = el('tr', { class: wd === 0 ? 'sun' : wd === 6 ? 'sat' : '' });
      tr.append(el('th', { scope: 'row' }, `${dayLabel(d)}(${wdOf(d)})`));
      st.slots.forEach(s => {
        const k = key(d, s.id);
        const list = st.assign[k] || [];
        const chips = list.map(id => el('span', { class: 'chip c-' + pref(st, id, d, s.id) }, staffName(id)));
        const diff = s.need - list.length;
        tr.append(el('td', { class: bad.has(k) ? 'flag' : '' }, el('button', { class: 'slotbtn', onclick: () => openDialog(d, s) },
          chips, diff > 0 ? el('span', { class: 'lack' }, `あと${diff}人`) : '', !list.length && diff <= 0 ? '—' : '')));
      });
      tb.append(tr);
    });
    table.append(tb); wrap.append(table);

    const wl = $('warnings'); wl.replaceChildren();
    if (!warns.length) wl.append(el('li', { class: 'ok' }, st.staff.length ? '問題はありません。' : 'スタッフを追加すると確認が始まります。'));
    warns.forEach(w => wl.append(el('li', { class: 'w-' + w.type }, w.text)));

    const sm = $('summary'); sm.replaceChildren();
    sm.append(el('tr', {}, el('th', {}, '名前'), el('th', {}, '回数'), el('th', {}, '希望どおり')));
    st.staff.forEach(s => {
      let n = 0, want = 0, wantTotal = 0;
      dateRange(st.start, st.end).forEach(d => st.slots.forEach(sl => {
        const on = (st.assign[key(d, sl.id)] || []).includes(s.id);
        if (on) n++;
        if (pref(st, s.id, d, sl.id) === 'want') { wantTotal++; if (on) want++; }
      }));
      sm.append(el('tr', {}, el('td', {}, s.name), el('td', {}, String(n)), el('td', {}, wantTotal ? `${want}/${wantTotal}` : '—')));
    });
  }

  const dlg = $('dlg');
  function openDialog(d, slot) {
    const k = key(d, slot.id);
    $('dlg-title').textContent = `${dayLabel(d)}(${wdOf(d)}) ${slot.label}`;
    const draw = () => {
      const cur = st.assign[k] || [];
      $('dlg-need').textContent = `必要 ${slot.need}人 / 現在 ${cur.length}人`;
      const ul = $('dlg-list'); ul.replaceChildren();
      if (!st.staff.length) ul.append(el('li', { class: 'empty' }, 'スタッフがいません。'));
      st.staff.forEach(s => {
        const p = pref(st, s.id, d, slot.id);
        const cb = el('input', { type: 'checkbox', checked: cur.includes(s.id), onchange: e => {
          const set = new Set(st.assign[k] || []);
          e.target.checked ? set.add(s.id) : set.delete(s.id);
          st.assign[k] = [...set]; save(); draw(); renderBoard();
        } });
        ul.append(el('li', {}, el('label', { class: 'p-' + p }, cb, el('span', {}, s.name), el('em', {}, LABEL[p]))));
      });
    };
    draw(); dlg.showModal();
  }

  $('btn-auto').addEventListener('click', () => {
    if (!st.staff.length) return alert('先にスタッフを追加してください。');
    if (Object.values(st.assign).some(l => l.length) && !confirm('今の割り当てを上書きして、自動で組み直しますか?')) return;
    st.assign = autoAssign(st); save(); renderBoard();
  });
  $('btn-clear').addEventListener('click', () => {
    if (!confirm('割り当てをすべて消しますか?')) return;
    st.assign = {}; save(); renderBoard();
  });
  $('btn-print').addEventListener('click', () => window.print());
  $('btn-csv').addEventListener('click', () => {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['日付', '曜日', ...st.slots.map(s => s.label)]];
    dateRange(st.start, st.end).forEach(d => rows.push([d, wdOf(d), ...st.slots.map(s => (st.assign[key(d, s.id)] || []).map(staffName).join('・'))]));
    download('shift.csv', '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
  });

  // ---- JSON保存・読込・サンプル ----
  function download(name, text, type) {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('btn-save').addEventListener('click', () => download('shift-data.json', JSON.stringify(st, null, 2), 'application/json'));
  $('file-load').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.slots || !d.staff || !d.start || !d.end) throw new Error();
      st = { prefs: {}, assign: {}, ...d }; save(); render();
    } catch { alert('このファイルは読み込めません。このツールで保存したJSONを選んでください。'); }
  });
  $('btn-sample').addEventListener('click', () => {
    if (!confirm('サンプルデータで置き換えますか?今のデータは消えます。')) return;
    st = blank();
    st.slots = [{ id: 'a', label: '9:00-13:00', need: 2 }, { id: 'b', label: '13:00-17:00', need: 2 }, { id: 'c', label: '17:00-21:00', need: 2 }];
    st.staff = [['田中', 4], ['佐藤', 3], ['鈴木', 5], ['高橋', 0], ['伊藤', 3]].map(([name, max], i) => ({ id: 's' + i, name, max }));
    const ds = dateRange(st.start, st.end);
    ds.forEach((d, i) => {
      st.slots.forEach(sl => {
        if (i % 7 === 0) setPref('s0', d, sl.id, 'no');
        if (i % 3 === 1 && sl.id === 'c') setPref('s1', d, sl.id, 'want');
        if (sl.id === 'a' && i % 2 === 0) setPref('s2', d, sl.id, 'want');
        if (i % 5 === 2 && sl.id !== 'c') setPref('s3', d, sl.id, 'no');
        if (i % 4 === 3) setPref('s4', d, sl.id, 'want');
      });
    });
    save(); showTab('prefs');
  });

  function render() {
    if (!$('tab-setup').hidden) renderSetup();
    if (!$('tab-prefs').hidden) renderPrefs();
    if (!$('tab-board').hidden) renderBoard();
  }
  render();
})();
