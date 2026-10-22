(() => {
  const S = Scheduler;
  const $ = id => document.getElementById(id);
  const STORE = 'shift-tool-v2';
  const SUBSTORE = 'shift-tool-submit-v2';
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const uid = () => Math.random().toString(36).slice(2, 9);
  const submitOnly = new URLSearchParams(location.search).get('mode') === 'submit';

  let st = load() || blank();
  let sub = loadSub();
  let curStaff = null;
  let brush = 'want';
  let sel = null;
  let patCache = { sig: '', res: null };

  // ---------- 状態 ----------
  function makeRows(startMin, endMin, stepMin) {
    const t = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    const rows = [];
    for (let m = startMin; m < endMin && rows.length < 48; m += stepMin) {
      rows.push({ id: uid(), label: `${t(m)}-${t(Math.min(m + stepMin, endMin))}` });
    }
    return rows;
  }
  function blank() {
    const today = new Date();
    const mon = new Date(today);
    mon.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
    const start = S.fmt(mon);
    return {
      v: 2, dates: S.dateRange(start, S.addDays(start, 6)), rows: makeRows(9 * 60, 17 * 60, 240),
      need: {}, staff: [], prefs: {}, assign: {}, seed: 0, alts: []
    };
  }
  let notice = '';
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (d && d.v === 2) return d;
      if (localStorage.getItem('shift-tool-v1')) notice = '以前の版で保存したデータは形式が変わったため読み込めませんでした。新しい表から作り直してください。';
    } catch { /* 保存データなし */ }
    return null;
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* 保存できない環境では無視 */ } }
  function loadSub() {
    try { const d = JSON.parse(localStorage.getItem(SUBSTORE)); if (d) return d; } catch { /* なし */ }
    return { frame: null, name: '', max: 0, prefs: {} };
  }
  function saveSub() { try { localStorage.setItem(SUBSTORE, JSON.stringify(sub)); } catch { /* 無視 */ } }

  // ---------- 共通 ----------
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
  const dayLabel = d => { const p = S.parse(d); return `${p.getMonth() + 1}/${p.getDate()}`; };
  const wdOf = d => WD[S.parse(d).getDay()];
  const staffName = id => (st.staff.find(s => s.id === id) || { name: '(削除済み)' }).name;
  const key = S.key;
  const frameOf = () => ({ dates: st.dates, rows: st.rows, need: st.need });

  function download(name, text, type) {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ポインタのドラッグ(マウス・タッチ共通)。キーボード操作はclickで拾う
  // 同じ要素には1回だけ登録し、2回目以降はハンドラだけ差し替える(再描画のたびに増えないように)
  function attachDrag(wrap, selector, handlers) {
    if (wrap._drag) { wrap._drag.h = handlers; return; }
    const ctx = wrap._drag = { h: handlers };
    let on = false;
    wrap.addEventListener('pointerdown', e => {
      const c = e.target.closest(selector);
      if (!c || e.button > 0) return;
      on = true; e.preventDefault(); ctx.h.down(c);
    });
    wrap.addEventListener('pointermove', e => {
      if (!on) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const c = t && t.closest(selector);
      if (c && wrap.contains(c)) ctx.h.move(c);
    });
    window.addEventListener('pointerup', () => { if (on) { on = false; if (ctx.h.up) ctx.h.up(); } });
    wrap.addEventListener('click', e => {
      if (e.detail !== 0) return;
      const c = e.target.closest(selector);
      if (c) { ctx.h.down(c); if (ctx.h.up) ctx.h.up(); }
    });
  }

  // ---------- タブ ----------
  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    ['table', 'prefs', 'board', 'submit'].forEach(t => { $('tab-' + t).hidden = t !== name; });
    render();
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- 1 表を作る ----------
  function frameChanged() { st.assign = {}; st.alts = []; save(); render(); }

  function renderTable() {
    const wrap = $('frame-grid'); wrap.replaceChildren();
    const t = el('table', { class: 'grid frame' });
    const hr = el('tr', {}, el('th', { class: 'corner' }, '時間帯 / 日付'));
    st.dates.forEach((d, c) => {
      hr.append(el('th', { class: 'colhead' },
        el('input', { type: 'date', value: d, 'aria-label': `${c + 1}列目の日付`, onchange: e => {
          const v = e.target.value;
          if (!v || st.dates.includes(v)) { if (v) alert('同じ日付の列がすでにあります。'); return render(); }
          st.dates[c] = v; frameChanged();
        } }),
        el('small', {}, `${wdOf(d)}曜日`),
        el('button', { class: 'x', 'aria-label': `${dayLabel(d)}の列を削除`, title: 'この列を削除', onclick: () => {
          if (st.dates.length <= 1) return alert('日付は1列以上必要です。');
          st.dates.splice(c, 1); sel = null; frameChanged();
        } }, '×')));
    });
    hr.append(el('th', { class: 'addcol' }, el('button', { class: 'add', onclick: () => {
      const last = st.dates[st.dates.length - 1];
      if (st.dates.length >= 62) return alert('日付は62列までです。');
      st.dates.push(S.addDays(last, 1)); frameChanged();
    } }, '＋日')));
    t.append(el('thead', {}, hr));

    const tb = el('tbody');
    st.rows.forEach((row, r) => {
      const tr = el('tr', {}, el('th', { class: 'rowhead' },
        el('input', { type: 'text', value: row.label, maxlength: 20, 'aria-label': `${r + 1}行目の時間帯名`, oninput: e => { row.label = e.target.value; save(); } }),
        el('button', { class: 'x', 'aria-label': `${row.label}の行を削除`, title: 'この行を削除', onclick: () => {
          if (st.rows.length <= 1) return alert('時間帯は1行以上必要です。');
          st.rows.splice(r, 1); sel = null; frameChanged();
        } }, '×')));
      st.dates.forEach((d, c) => {
        tr.append(el('td', {}, el('button', { class: 'needcell', 'data-r': r, 'data-c': c, 'aria-label': `${dayLabel(d)} ${row.label} 必要${S.needOf(st, d, row.id)}人` }, String(S.needOf(st, d, row.id)))));
      });
      tb.append(tr);
    });
    tb.append(el('tr', {}, el('th', { class: 'addrow', colspan: st.dates.length + 2 }, el('button', { class: 'add', onclick: () => {
      if (st.rows.length >= 48) return alert('時間帯は48行までです。');
      st.rows.push({ id: uid(), label: '新しい時間帯' }); frameChanged();
    } }, '＋時間帯'))));
    t.append(tb); wrap.append(t);
    markSel();
  }

  function markSel() {
    const info = $('sel-info');
    let n = 0;
    document.querySelectorAll('#frame-grid .needcell').forEach(b => {
      const r = +b.dataset.r, c = +b.dataset.c;
      const on = !!sel && r >= Math.min(sel.r1, sel.r2) && r <= Math.max(sel.r1, sel.r2) && c >= Math.min(sel.c1, sel.c2) && c <= Math.max(sel.c1, sel.c2);
      b.classList.toggle('sel', on);
      if (on) n++;
    });
    info.textContent = n ? `${n}セルを選択中` : 'セルが選ばれていません';
  }
  attachDrag($('frame-grid'), '.needcell', {
    down: c => { sel = { r1: +c.dataset.r, c1: +c.dataset.c, r2: +c.dataset.r, c2: +c.dataset.c }; markSel(); },
    move: c => { sel.r2 = +c.dataset.r; sel.c2 = +c.dataset.c; markSel(); }
  });
  $('need-apply').addEventListener('click', () => {
    if (!sel) return alert('先に、人数を変えたいセルを選んでください。');
    const n = Math.max(0, Math.min(30, Math.floor(+$('need-val').value) || 0));
    for (let r = Math.min(sel.r1, sel.r2); r <= Math.max(sel.r1, sel.r2); r++) {
      for (let c = Math.min(sel.c1, sel.c2); c <= Math.max(sel.c1, sel.c2); c++) st.need[key(st.dates[c], st.rows[r].id)] = n;
    }
    save(); renderTable();
  });

  // 範囲から列・行を作る
  function openDlg(dlg) { dlg.showModal(); }
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('btn-gen-dates').addEventListener('click', () => {
    $('gd-start').value = st.dates[0]; $('gd-end').value = st.dates[st.dates.length - 1];
    openDlg($('dlg-dates'));
  });
  $('form-dates').addEventListener('submit', e => {
    e.preventDefault();
    const list = S.dateRange($('gd-start').value, $('gd-end').value);
    if (!list.length) return alert('最後の日は、最初の日以降にしてください。');
    const need = Math.max(0, Math.floor(+$('gd-need').value) || 0);
    if (hasWork() && !confirm('日付の列を置き換えます。今の振り分けは消えます。続けますか?')) return;
    st.dates = list;
    st.rows.forEach(r => list.forEach(d => { st.need[key(d, r.id)] = need; }));
    sel = null; $('dlg-dates').close(); frameChanged();
  });
  $('btn-gen-rows').addEventListener('click', () => openDlg($('dlg-rows')));
  $('form-rows').addEventListener('submit', e => {
    e.preventDefault();
    const tm = v => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
    const a = tm($('gr-start').value), b = tm($('gr-end').value);
    if (!(b > a)) return alert('最後の時刻は、最初の時刻より後にしてください。');
    const kind = document.querySelector('input[name="gr-kind"]:checked').value;
    const step = kind === 'step' ? Math.round(+$('gr-step').value * 60) : Math.ceil((b - a) / Math.max(1, Math.floor(+$('gr-count').value)));
    if (!(step >= 30)) return alert('区切りは30分以上にしてください。');
    const rows = makeRows(a, b, step);
    if (hasWork() && !confirm('時間帯の行を置き換えます。今の振り分けは消え、配布済みの枠ファイルは使えなくなります。続けますか?')) return;
    const need = Math.max(0, Math.floor(+$('gr-need').value) || 0);
    st.rows = rows;
    rows.forEach(r => st.dates.forEach(d => { st.need[key(d, r.id)] = need; }));
    sel = null; $('dlg-rows').close(); frameChanged();
  });
  function hasWork() { return Object.values(st.assign).some(l => l.length); }

  $('btn-frame-export').addEventListener('click', () => {
    const f = frameOf();
    download('shift-frame.json', JSON.stringify({ type: 'shift-frame', version: 2, dates: f.dates, rows: f.rows, need: f.need }, null, 2), 'application/json');
  });

  // ---------- ペン(希望の塗り方) ----------
  const BRUSHES = [['want', '○ 入りたい'], ['no', '× 入れない'], ['clear', '消す(入れる)']];
  function renderBrushes() {
    ['brush-proxy', 'brush-sub'].forEach(id => {
      const box = $(id); if (!box) return;
      box.replaceChildren(el('div', { class: 'brushbar', role: 'group', 'aria-label': 'ペンの種類' },
        BRUSHES.map(([v, label]) => el('button', { class: 'brush b-' + v, 'aria-pressed': String(brush === v), onclick: () => { brush = v; renderBrushes(); } }, label))));
    });
  }
  const MARK = { want: '○', no: '×' };

  // frame: {dates, rows}、get(d,rowId)→'want'|'no'|'ok'、set(d,rowId,v)
  function paintGrid(wrap, frame, get, set, onDone) {
    wrap.replaceChildren();
    const t = el('table', { class: 'grid paint' });
    const hr = el('tr', {}, el('th', { class: 'corner' }, '時間帯 / 日付'));
    frame.dates.forEach(d => hr.append(el('th', {}, el('button', { class: 'daybtn', 'data-line': 'c', 'data-d': d }, `${dayLabel(d)}(${wdOf(d)})`))));
    t.append(el('thead', {}, hr));
    const tb = el('tbody');
    frame.rows.forEach(row => {
      const tr = el('tr', {}, el('th', { scope: 'row' }, el('button', { class: 'daybtn', 'data-line': 'r', 'data-row': row.id }, row.label)));
      frame.dates.forEach(d => {
        const v = get(d, row.id);
        tr.append(el('td', {}, el('button', { class: 'cell p-' + v, 'data-d': d, 'data-row': row.id, 'aria-label': `${dayLabel(d)} ${row.label}` }, MARK[v] || '')));
      });
      tb.append(tr);
    });
    t.append(tb); wrap.append(t);

    const paint = (btn, v) => {
      set(btn.dataset.d, btn.dataset.row, v);
      btn.className = 'cell p-' + v; btn.textContent = MARK[v] || '';
    };
    let target = 'ok';
    attachDrag(wrap, '.cell, .daybtn', {
      down: c => {
        if (c.classList.contains('daybtn')) {
          const cells = [...wrap.querySelectorAll('.cell')].filter(b => c.dataset.line === 'c' ? b.dataset.d === c.dataset.d : b.dataset.row === c.dataset.row);
          const want = brush === 'clear' ? 'ok' : brush;
          const allSame = cells.every(b => get(b.dataset.d, b.dataset.row) === want);
          cells.forEach(b => paint(b, allSame ? 'ok' : want));
          target = null;
        } else {
          target = brush === 'clear' || get(c.dataset.d, c.dataset.row) === brush ? 'ok' : brush;
          paint(c, target);
        }
      },
      move: c => { if (target && c.classList.contains('cell')) paint(c, target); },
      up: () => { if (onDone) onDone(); }
    });
  }

  // ---------- 2 希望を集める ----------
  function renderPrefs() {
    const fl = $('staff-list'); fl.replaceChildren();
    if (!st.staff.length) fl.append(el('li', { class: 'empty' }, 'まだスタッフがいません。希望ファイルを読み込んでください。'));
    if (!st.staff.some(s => s.id === curStaff)) curStaff = st.staff[0] && st.staff[0].id;
    st.staff.forEach(s => {
      const cnt = { want: 0, no: 0 };
      Object.entries(st.prefs).forEach(([k, v]) => { if (k.startsWith(s.id + '|')) cnt[v]++; });
      fl.append(el('li', { class: s.id === curStaff ? 'cur' : '' },
        el('label', { class: 'grow' }, '名前', el('input', { type: 'text', value: s.name, maxlength: 20, oninput: e => { s.name = e.target.value; save(); } })),
        el('label', {}, '週の上限', el('input', { type: 'number', min: 1, max: 21, value: s.max || '', placeholder: 'なし', oninput: e => { s.max = +e.target.value || 0; save(); } })),
        el('span', { class: 'counts' }, `○${cnt.want} ×${cnt.no}`),
        el('button', { class: 'ghost small', onclick: () => { curStaff = s.id; renderPrefs(); } }, '確認・修正'),
        el('button', { class: 'del', 'aria-label': `${s.name}を削除`, onclick: () => {
          if (!confirm(`${s.name}さんを削除しますか?希望と振り分けも消えます。`)) return;
          st.staff = st.staff.filter(x => x !== s);
          Object.keys(st.assign).forEach(k => { st.assign[k] = st.assign[k].filter(i => i !== s.id); });
          Object.keys(st.prefs).forEach(k => { if (k.startsWith(s.id + '|')) delete st.prefs[k]; });
          save(); renderPrefs();
        } }, '削除')));
    });
    const wrap = $('proxy-grid');
    const cur = st.staff.find(s => s.id === curStaff);
    $('proxy-title').textContent = cur ? `${cur.name}さんの希望` : '希望の確認・修正';
    $('brush-proxy').hidden = !cur;
    if (!cur) { wrap.replaceChildren(el('p', { class: 'empty' }, 'スタッフを選ぶと、ここに希望の表が出ます。')); return; }
    renderBrushes();
    paintGrid(wrap, st, (d, r) => st.prefs[`${cur.id}|${d}|${r}`] || 'ok',
      (d, r, v) => { const k = `${cur.id}|${d}|${r}`; if (v === 'ok') delete st.prefs[k]; else st.prefs[k] = v; },
      () => { save(); renderPrefs(); });
  }
  $('staff-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('staff-name').value.trim();
    if (!name) return;
    if (st.staff.some(s => s.name === name)) return alert('同じ名前のスタッフがすでにいます。');
    const s = { id: uid(), name, max: 0 };
    st.staff.push(s); curStaff = s.id; $('staff-name').value = '';
    save(); renderPrefs();
  });

  $('pref-files').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    const log = $('import-log'); log.replaceChildren();
    const say = (ok, text) => log.append(el('li', { class: ok ? 'ok' : 'ng' }, text));
    const myKey = S.frameKey(st);
    for (const f of files) {
      try {
        const d = JSON.parse(await f.text());
        if (d.type !== 'shift-pref') throw new Error('希望ファイルではありません(スタッフ用の画面で書き出したファイルを選んでください)');
        if (d.frameKey !== myKey) throw new Error('今の表と日付・時間帯の行が違います(枠ファイルを配ったあとに表を変えた可能性があります)');
        const name = String(d.name || '').trim();
        if (!name) throw new Error('名前が入っていません');
        let s = st.staff.find(x => x.name === name);
        if (s && !confirm(`${name}さんはすでに読み込み済みです。このファイルの内容で上書きしますか?`)) { say(false, `${f.name}: ${name}さんは上書きせずに残しました`); continue; }
        if (!s) { s = { id: uid(), name, max: 0 }; st.staff.push(s); }
        Object.keys(st.prefs).forEach(k => { if (k.startsWith(s.id + '|')) delete st.prefs[k]; });
        let n = 0;
        Object.entries(d.prefs || {}).forEach(([k, v]) => {
          const [date, row] = k.split('|');
          if ((v === 'want' || v === 'no') && st.dates.includes(date) && st.rows.some(r => r.id === row)) { st.prefs[`${s.id}|${k}`] = v; n++; }
        });
        if (d.max) s.max = Math.max(0, Math.floor(+d.max) || 0);
        curStaff = s.id;
        say(true, `${f.name}: ${name}さんを読み込みました(希望${n}件)`);
      } catch (err) {
        say(false, `${f.name}: 読み込めませんでした。${err instanceof SyntaxError ? 'JSONとして読めません' : err.message}`);
      }
    }
    save(); renderPrefs();
  });

  // ---------- 3 振り分ける ----------
  function fmtBig(b) {
    const s = b.toString();
    if (s.length <= 9) return Number(b).toLocaleString('ja-JP');
    return `約 ${s[0]}.${s.slice(1, 3)} × 10^${s.length - 1}`;
  }
  function patSig() {
    return JSON.stringify([st.dates, st.rows.map(r => r.id), st.need, st.staff.map(s => [s.id, s.max]), st.prefs, $('pat-mode').value]);
  }
  function renderPatterns(force) {
    const sig = patSig();
    if (!force && patCache.sig === sig && patCache.res) return showPatterns(patCache.res);
    const mode = $('pat-mode').value;
    if (!force && mode === 'exact') { // 厳密指定は重いので、ボタンを押したときだけ
      $('pat-value').textContent = '—'; $('pat-note').textContent = '「数え直す」を押すと厳密に数えます。';
      return;
    }
    if (!st.staff.length) { $('pat-value').textContent = '—'; $('pat-note').textContent = 'スタッフを読み込むと数えられます。'; return; }
    $('pat-value').textContent = '計算中…';
    setTimeout(() => {
      const res = S.countPatterns(st, { mode, seed: 7 });
      patCache = { sig, res }; showPatterns(res);
    }, 0);
  }
  function showPatterns(r) {
    const v = $('pat-value'), n = $('pat-note');
    const cond = '数えているのは、必要人数ちょうどを満たし、「入れない」と週の上限を守る振り分けです。';
    if (r.infeasible) { v.textContent = '0 通り'; n.textContent = '「入れない」でない人の数が必要人数に足りない枠があります。必要人数か希望を見直してください。'; return; }
    if (r.kind === 'exact') {
      v.textContent = `${fmtBig(r.value)} 通り`;
      n.textContent = `厳密に数えた値です。${r.noCap ? '週の上限がないので、各枠の組み合わせの積になります。' : ''}${cond}`;
    } else if (r.value === null) {
      v.textContent = '非常に少ない';
      n.textContent = `${r.samples}回試しても、週の上限を守って全部の枠を埋められませんでした。週の上限か必要人数を見直してください(週の上限を無視した上限値は ${fmtBig(r.ub)} 通り)。`;
    } else {
      v.textContent = `${fmtBig(r.value)} 通り(概算)`;
      n.textContent = `枠を順に決めていき、週の上限を守れる人だけから無作為に選ぶ試行を${r.samples}回行って推定した値です(上限を無視した場合は ${fmtBig(r.ub)} 通り)。誤差があります。${r.forcedAborted ? '厳密に数える量が大きすぎたため概算に切り替えました。' : ''}${cond}`;
    }
  }
  $('pat-run').addEventListener('click', () => renderPatterns(true));
  $('pat-mode').addEventListener('change', () => renderPatterns(false));

  function scoreText(sc) {
    const pct = sc.wantTotal ? Math.round(sc.wantHit / sc.wantTotal * 100) : null;
    return [`入りたい希望: ${sc.wantTotal ? `${sc.wantHit}/${sc.wantTotal}(${pct}%)` : '希望なし'}`, `人数不足: ${sc.short}`, `回数の差: ${sc.spread}`];
  }

  function makeAlt(assign) {
    const keep = st.assign; st.assign = assign;
    const sc = S.score(st); st.assign = keep;
    return sc;
  }
  function newPlan() {
    if (!st.staff.length) return alert('先にスタッフを追加してください。');
    st.seed = (st.seed || 0) + 1;
    const assign = S.autoAssign(st, { seed: st.seed });
    st.alts = [...(st.alts || []), { seed: st.seed, assign, score: makeAlt(assign) }].slice(-3);
    st.assign = JSON.parse(JSON.stringify(assign));
    save(); renderBoard();
  }
  $('btn-auto').addEventListener('click', () => {
    if (hasWork() && !confirm('今の振り分けを、自動で組んだ案に置き換えますか?')) return;
    newPlan();
  });
  $('btn-alt').addEventListener('click', () => {
    if (!st.staff.length) return alert('先にスタッフを追加してください。');
    if (hasWork() && !confirm('今の振り分けを、別の案に置き換えますか?(手で直した内容は消えます)')) return;
    newPlan();
  });
  $('btn-clear').addEventListener('click', () => {
    if (!confirm('振り分けをすべて消しますか?')) return;
    st.assign = {}; save(); renderBoard();
  });

  function renderBoard() {
    const warns = S.check(st);
    const bad = new Set(warns.filter(w => w.date).map(w => key(w.date, w.rowId)));
    const wrap = $('board-grid'); wrap.replaceChildren();
    const table = el('table', { class: 'grid board' });
    table.append(el('thead', {}, el('tr', {}, el('th', { class: 'corner' }, '時間帯 / 日付'),
      st.dates.map(d => el('th', { class: wdOf(d) === '日' ? 'sun' : wdOf(d) === '土' ? 'sat' : '' }, `${dayLabel(d)}(${wdOf(d)})`)))));
    const tb = el('tbody');
    st.rows.forEach(row => {
      const tr = el('tr', {}, el('th', { scope: 'row' }, row.label));
      st.dates.forEach(d => {
        const k = key(d, row.id), need = S.needOf(st, d, row.id);
        const list = st.assign[k] || [];
        const diff = need - list.length;
        tr.append(el('td', { class: bad.has(k) ? 'flag' : '' }, el('button', { class: 'slotbtn', 'aria-label': `${dayLabel(d)} ${row.label} ${list.map(staffName).join('、') || '誰もいない'}`, onclick: () => openDialog(d, row) },
          list.map(id => el('span', { class: 'chip c-' + S.pref(st, id, d, row.id) }, staffName(id))),
          diff > 0 ? el('span', { class: 'lack' }, `あと${diff}人`) : '',
          !list.length && need === 0 ? '—' : '')));
      });
      tb.append(tr);
    });
    table.append(tb); wrap.append(table);

    const wl = $('warnings'); wl.replaceChildren();
    if (!warns.length) wl.append(el('li', { class: 'ok' }, st.staff.length ? '問題はありません。' : 'スタッフを読み込むと確認が始まります。'));
    warns.forEach(w => wl.append(el('li', { class: 'w-' + w.type }, w.text)));

    $('score').replaceChildren(...scoreText(S.score(st)).flatMap((t, i) => [i ? el('br') : '', t]));

    const alts = $('alts'); alts.replaceChildren();
    (st.alts || []).forEach((a, i) => {
      const sc = scoreText(a.score);
      alts.append(el('button', { class: 'alt', onclick: () => {
        if (!confirm('この案を表示します。今の表示は、手で直した内容を含めて置き換わります。')) return;
        st.assign = JSON.parse(JSON.stringify(a.assign)); save(); renderBoard();
      } }, el('b', {}, `案${a.seed}`), el('span', {}, sc.join(' / '))));
    });
    if ((st.alts || []).length) alts.prepend(el('span', { class: 'hint' }, '出した案(新しい順に3つまで。押すと表示):'));

    const sm = $('summary'); sm.replaceChildren();
    sm.append(el('tr', {}, el('th', {}, '名前'), el('th', {}, '回数'), el('th', {}, '希望どおり')));
    st.staff.forEach(s => {
      let n = 0, want = 0, wantTotal = 0;
      st.dates.forEach(d => st.rows.forEach(r => {
        const on = (st.assign[key(d, r.id)] || []).includes(s.id);
        if (on) n++;
        if (S.pref(st, s.id, d, r.id) === 'want') { wantTotal++; if (on) want++; }
      }));
      sm.append(el('tr', {}, el('td', {}, s.name), el('td', {}, String(n)), el('td', {}, wantTotal ? `${want}/${wantTotal}` : '—')));
    });
    renderPatterns(false);
  }

  const dlg = $('dlg');
  function openDialog(d, row) {
    const k = key(d, row.id), need = S.needOf(st, d, row.id);
    $('dlg-title').textContent = `${dayLabel(d)}(${wdOf(d)}) ${row.label}`;
    const draw = () => {
      const cur = st.assign[k] || [];
      $('dlg-need').textContent = `必要 ${need}人 / 今 ${cur.length}人`;
      const ul = $('dlg-list'); ul.replaceChildren();
      if (!st.staff.length) ul.append(el('li', { class: 'empty' }, 'スタッフがいません。'));
      st.staff.forEach(s => {
        const p = S.pref(st, s.id, d, row.id);
        ul.append(el('li', {}, el('label', { class: 'p-' + p }, el('input', { type: 'checkbox', checked: cur.includes(s.id), onchange: e => {
          const set = new Set(st.assign[k] || []);
          e.target.checked ? set.add(s.id) : set.delete(s.id);
          st.assign[k] = [...set]; save(); draw(); renderBoard();
        } }), el('span', {}, s.name), el('em', {}, { want: '入りたい', no: '入れない', ok: '' }[p]))));
      });
    };
    draw(); dlg.showModal();
  }

  $('btn-print').addEventListener('click', () => window.print());
  $('btn-csv').addEventListener('click', () => {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['時間帯', ...st.dates.map(d => `${d}(${wdOf(d)})`)]];
    st.rows.forEach(r => rows.push([r.label, ...st.dates.map(d => (st.assign[key(d, r.id)] || []).map(staffName).join('・'))]));
    download('shift.csv', '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
  });

  // ---------- スタッフ用:希望を出す ----------
  function setSubFrame(frame) {
    const same = sub.frame && S.frameKey(sub.frame) === S.frameKey(frame);
    sub.frame = { dates: frame.dates, rows: frame.rows, need: frame.need || {} };
    if (!same) sub.prefs = {};
    saveSub(); renderSubmit();
  }
  function renderSubmit() {
    $('sub-name').value = sub.name || '';
    $('sub-max').value = sub.max || '';
    $('btn-use-frame').hidden = submitOnly;
    const wrap = $('sub-grid');
    if (!sub.frame) {
      $('frame-status').textContent = 'まだ読み込んでいません';
      wrap.replaceChildren(el('p', { class: 'empty' }, '担当者から受け取った枠ファイル(shift-frame.json)を読み込むと、ここに表が出ます。'));
      $('brush-sub').replaceChildren();
    } else {
      const f = sub.frame;
      $('frame-status').textContent = `読み込み済み: ${dayLabel(f.dates[0])}〜${dayLabel(f.dates[f.dates.length - 1])}、${f.rows.length}つの時間帯`;
      renderBrushes();
      paintGrid(wrap, f, (d, r) => sub.prefs[`${d}|${r}`] || 'ok',
        (d, r, v) => { const k = `${d}|${r}`; if (v === 'ok') delete sub.prefs[k]; else sub.prefs[k] = v; },
        () => { saveSub(); updateSubStatus(); });
    }
    updateSubStatus();
  }
  function updateSubStatus() {
    const v = Object.values(sub.prefs);
    $('sub-status').textContent = sub.frame ? `○ ${v.filter(x => x === 'want').length}件 / × ${v.filter(x => x === 'no').length}件` : '';
  }
  $('sub-name').addEventListener('input', e => { sub.name = e.target.value; saveSub(); });
  $('sub-max').addEventListener('input', e => { sub.max = Math.max(0, Math.floor(+e.target.value) || 0); saveSub(); });
  $('frame-file').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.type !== 'shift-frame' || !Array.isArray(d.dates) || !Array.isArray(d.rows)) throw new Error();
      setSubFrame(d);
    } catch { alert('この枠ファイルは読み込めません。担当者が「枠ファイルを書き出す」で作ったファイルを選んでください。'); }
  });
  $('btn-use-frame').addEventListener('click', () => setSubFrame(frameOf()));
  $('btn-pref-export').addEventListener('click', () => {
    if (!sub.frame) return alert('先に枠ファイルを読み込んでください。');
    const name = (sub.name || '').trim();
    if (!name) { $('sub-name').focus(); return alert('名前を入れてください。'); }
    const body = { type: 'shift-pref', version: 2, frameKey: S.frameKey(sub.frame), name, max: sub.max || 0, prefs: sub.prefs };
    download(`${name}_希望.json`, JSON.stringify(body, null, 2), 'application/json');
  });

  // ---------- 全データの保存・読込・サンプル ----------
  $('btn-save').addEventListener('click', () => download('shift-data.json', JSON.stringify(st, null, 2), 'application/json'));
  $('file-load').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.v !== 2 || !d.dates || !d.rows || !d.staff) throw new Error();
      st = { need: {}, prefs: {}, assign: {}, alts: [], seed: 0, ...d }; sel = null; save(); render();
    } catch { alert('このファイルは読み込めません。このツールの「全データをJSON保存」で作ったファイルを選んでください。'); }
  });
  $('btn-sample').addEventListener('click', () => {
    if (!confirm('サンプルデータで置き換えますか?今のデータは消えます。')) return;
    st = blank();
    st.rows = [{ id: 'a', label: '9:00-13:00' }, { id: 'b', label: '13:00-17:00' }, { id: 'c', label: '17:00-21:00' }];
    st.dates.forEach((d, i) => st.rows.forEach(r => { st.need[key(d, r.id)] = r.id === 'c' && i >= 5 ? 3 : 2; }));
    st.staff = [['田中', 6], ['佐藤', 5], ['鈴木', 7], ['高橋', 0], ['伊藤', 5], ['渡辺', 6]].map(([name, max], i) => ({ id: 's' + i, name, max }));
    st.dates.forEach((d, i) => st.rows.forEach(r => {
      const set = (n, v) => { st.prefs[`s${n}|${d}|${r.id}`] = v; };
      if (i % 7 === 0) set(0, 'no');
      if (i % 3 === 1 && r.id === 'c') set(1, 'want');
      if (r.id === 'a' && i % 2 === 0) set(2, 'want');
      if (i % 5 === 2 && r.id !== 'c') set(3, 'no');
      if (i % 4 === 3) set(4, 'want');
      if (i % 6 === 5 && r.id === 'a') set(5, 'no');
    }));
    sel = null; curStaff = 's0'; save(); showTab('prefs');
  });

  function render() {
    const n = $('notice');
    n.hidden = !notice; n.textContent = notice;
    if (!$('tab-table').hidden) renderTable();
    if (!$('tab-prefs').hidden) renderPrefs();
    if (!$('tab-board').hidden) renderBoard();
    if (!$('tab-submit').hidden) renderSubmit();
  }

  if (submitOnly) {
    document.body.classList.add('submit-only');
    showTab('submit');
  } else render();
})();
