/* =============================================================
 * app.js — シフトカレンダー SPA本体
 *
 * ビュー2つ:
 *   トップビュー … 今週ストリップ + 月カレンダー
 *   日ビュー     … その日のシフト表（時刻レール×キャストチップ） / 画像
 *
 * ルーティングは ?date=YYYY-MM-DD + pushState。
 * STUDIO の iframe sandbox 内で history 操作が失敗する環境では
 * 画面内遷移のみにフォールバックする（CastShowcase と同じ方針）。
 *
 * 描画は el()（textContent）のみで行い、innerHTML は使わない。
 * ============================================================= */
(function () {
  'use strict';

  const DATA = window.SHIFTCAL || { weekStarts: [], casts: {}, weeks: {}, images: {} };

  // date("YYYY-MM-DD") → その日の slots 参照
  const dayByDate = new Map();
  for (const ws of DATA.weekStarts) {
    for (const day of (DATA.weeks[ws] || { days: [] }).days) {
      dayByDate.set(day.date, day);
    }
  }
  const allDates = [...dayByDate.keys()].sort();
  const TODAY = todayJST();

  // テーマは luxe に一本化済み（2026-07-23 決定。html の data-theme="luxe" 固定）

  const params = new URLSearchParams(location.search);

  // 背景モード（埋め込み先に馴染ませる）: ?bg=clear（完全透過） / ?bg=veil（半透明ベール）
  const bgMode = params.get('bg');
  if (bgMode === 'clear' || bgMode === 'veil') {
    document.documentElement.dataset.bg = bgMode;
  }

  // ---------- ルーティング ----------
  let canHistory = true;

  function navigate(date, replace) {
    if (canHistory) {
      try {
        const url = new URL(location.href);
        if (date) url.searchParams.set('date', date);
        else url.searchParams.delete('date');
        history[replace ? 'replaceState' : 'pushState']({ date }, '', url);
      } catch (e) {
        canHistory = false;
      }
    }
    render(date);
  }

  window.addEventListener('popstate', (e) => {
    render((e.state && e.state.date) || new URLSearchParams(location.search).get('date'));
  });

  // ---------- 描画本体 ----------
  const topView = document.getElementById('topView');
  const dayView = document.getElementById('dayView');

  /** アニメーションを付け直して再生する（連続遷移でも毎回動くように） */
  function replayAnim(node) {
    node.classList.remove('view-anim');
    void node.offsetWidth; // reflow でアニメーションをリセット
    node.classList.add('view-anim');
  }

  function render(date) {
    if (date && dayByDate.has(date)) {
      renderDay(date);
      topView.hidden = true;
      dayView.hidden = false;
      replayAnim(dayView);
    } else {
      renderTop();
      dayView.hidden = true;
      topView.hidden = false;
      replayAnim(topView);
      centerStrip(true); // 表示されてから（レイアウト確定後）中央寄せ
    }
    window.scrollTo(0, 0);
  }

  // ---------- トップビュー ----------
  let calMonth = null; // "YYYY-MM"

  function castsOfDay(day) {
    // その日の出現キャスト（スロット順に重複なし）
    const seen = [];
    for (const slot of day.slots) {
      for (const name of slot.n) {
        if (!seen.includes(name)) seen.push(name);
      }
    }
    return seen;
  }

  /** ストリップ上で初期表示の中心に置く日（今日。公開前後の期間なら最寄りの公開日） */
  function stripFocusDate() {
    if (dayByDate.has(TODAY)) return TODAY;
    const later = allDates.find((d) => d > TODAY);
    return later || allDates[allDates.length - 1];
  }

  /** 今日（または最寄り日）のカードをストリップ中央へスクロール */
  function centerStrip(instant) {
    const strip = document.getElementById('weekStrip');
    const target = strip.querySelector('.is-focus');
    if (!target) return;
    const left = target.offsetLeft - (strip.clientWidth - target.offsetWidth) / 2;
    strip.scrollTo({ left, behavior: instant ? 'instant' : 'smooth' });
  }

  function renderTop() {
    const strip = document.getElementById('weekStrip');
    strip.textContent = '';
    const first = allDates[0];
    const last = allDates[allDates.length - 1];
    document.getElementById('weekRangeEn').textContent =
      first ? `${first.replaceAll('-', '.')} - ${last.replaceAll('-', '.')}` : '';

    const focus = stripFocusDate();
    // 公開済みの全日を1本のスライダーとして並べる（過去週へもスワイプで遡れる）
    for (const date of allDates) {
      const day = dayByDate.get(date);
      const card = el('button', 'week__day');
      card.type = 'button';
      if (date === TODAY) card.classList.add('is-today');
      if (date === focus) card.classList.add('is-focus');

      const [, m, d] = dateParts(date);
      const head = el('div', 'week__dayhead');
      head.append(
        el('span', 'week__wd', WEEKDAY_EN[weekdayIndex(date)]),
        el('span', 'week__num', `${m}/${d}`),
      );
      card.append(head);
      if (date === TODAY) card.append(el('span', 'week__todaybadge', 'TODAY'));

      const names = castsOfDay(day);
      const faces = el('div', 'week__faces');
      const shown = names.slice(0, 8);
      for (const name of shown) {
        faces.append(castFace(name));
      }
      if (names.length > shown.length) {
        faces.append(el('span', 'week__more', `+${names.length - shown.length}`));
      }
      if (!names.length) faces.append(el('span', 'week__empty', '—'));
      card.append(faces);
      card.append(el('div', 'week__count', `${names.length}名`));
      card.addEventListener('click', () => navigate(date));
      strip.append(card);
    }

    // 月カレンダー
    if (!calMonth) {
      calMonth = (dayByDate.has(TODAY) ? TODAY : (allDates[allDates.length - 1] || TODAY)).slice(0, 7);
    }
    renderCalendar();
  }

  function monthRange() {
    const months = allDates.map((d) => d.slice(0, 7));
    const min = months[0] || TODAY.slice(0, 7);
    const max = months[months.length - 1] || TODAY.slice(0, 7);
    return [min, max];
  }

  function renderCalendar() {
    const [minM, maxM] = monthRange();
    document.getElementById('calMonth').textContent = formatMonthJa(calMonth);
    const prev = document.getElementById('calPrev');
    const next = document.getElementById('calNext');
    prev.disabled = calMonth <= minM;
    next.disabled = calMonth >= maxM;
    prev.onclick = () => { calMonth = addMonths(calMonth, -1); renderCalendar(); };
    next.onclick = () => { calMonth = addMonths(calMonth, 1); renderCalendar(); };

    const grid = document.getElementById('calGrid');
    grid.textContent = '';
    // カレンダーは日曜始まりで表示する（データ週=月曜始まりとは独立した表示上の都合）
    for (const wd of ['日', '月', '火', '水', '木', '金', '土']) {
      grid.append(el('div', 'cal__wd', wd));
    }

    const first = `${calMonth}-01`;
    const start = sundayStartOf(first);
    const nextMonth = addMonths(calMonth, 1);
    const isSunday = (d) => (weekdayIndex(d) + 1) % 7 === 0;
    for (let d = start; ; d = addDays(d, 1)) {
      const inMonth = d.slice(0, 7) === calMonth;
      if (!inMonth && d >= `${nextMonth}-01` && isSunday(d)) break;
      const day = dayByDate.get(d);
      const cell = el(day ? 'button' : 'div', 'cal__cell');
      if (day) cell.type = 'button';
      if (!inMonth) cell.classList.add('is-out');
      if (d === TODAY) cell.classList.add('is-today');
      cell.append(el('span', 'cal__daynum', String(Number(d.slice(8)))));
      if (day) {
        cell.classList.add('has-data');
        cell.append(el('span', 'cal__count', `${castsOfDay(day).length}名`));
        cell.addEventListener('click', () => navigate(d));
      }
      grid.append(cell);
    }
  }

  // ---------- 日ビュー ----------
  let activeTab = 'table';

  function renderDay(date) {
    document.getElementById('dayDate').textContent = formatDateJa(date);

    const idx = allDates.indexOf(date);
    const prev = document.getElementById('dayPrev');
    const next = document.getElementById('dayNext');
    prev.disabled = idx <= 0;
    next.disabled = idx >= allDates.length - 1;
    prev.onclick = () => navigate(allDates[idx - 1]);
    next.onclick = () => navigate(allDates[idx + 1]);
    document.getElementById('dayBack').onclick = () => navigate(null);

    // タブ（画像がある日だけ「画像」タブを出す）
    const imagePath = DATA.images[date];
    const tabs = document.getElementById('dayTabs');
    tabs.hidden = !imagePath;
    if (!imagePath) activeTab = 'table';
    const tabTable = document.getElementById('tabTable');
    const tabImage = document.getElementById('tabImage');
    tabTable.onclick = () => {
      activeTab = 'table';
      renderDay(date);
      replayAnim(document.getElementById('schedTable'));
    };
    tabImage.onclick = () => {
      activeTab = 'image';
      renderDay(date);
      replayAnim(document.getElementById('schedImage'));
    };
    tabTable.classList.toggle('is-active', activeTab === 'table');
    tabImage.classList.toggle('is-active', activeTab === 'image');
    tabTable.setAttribute('aria-selected', String(activeTab === 'table'));
    tabImage.setAttribute('aria-selected', String(activeTab === 'image'));

    const tableSec = document.getElementById('schedTable');
    const imageSec = document.getElementById('schedImage');
    tableSec.hidden = activeTab !== 'table';
    imageSec.hidden = activeTab !== 'image';
    if (activeTab === 'image') {
      document.getElementById('schedImg').src = imagePath;
      return;
    }

    // シフト表: 時刻レール × キャストチップ
    const day = dayByDate.get(date);
    tableSec.textContent = '';
    const labels = timeLabels(day.slots.map((s) => s.t));
    day.slots.forEach((slot, i) => {
      const row = el('div', 'sched__row');
      if (!slot.n.length) row.classList.add('is-empty');
      row.append(el('div', 'sched__time', labels[i]));
      const cell = el('div', 'sched__casts');
      if (slot.n.length) {
        for (const name of slot.n) cell.append(castChip(name, date));
      } else {
        cell.append(el('span', 'sched__none', '—'));
      }
      row.append(cell);
      tableSec.append(row);
    });
  }

  // ---------- キャスト表示部品 ----------
  function castInfo(name) {
    return DATA.casts[name] || { r: '', i: null };
  }

  /** 丸アイコン（画像なしは頭文字） */
  function castFace(name) {
    const info = castInfo(name);
    if (info.i) {
      const img = el('img', 'face');
      img.src = info.i;
      img.alt = name;
      img.loading = 'lazy';
      if (info.r) img.classList.add(`rank-${info.r}`);
      return img;
    }
    const span = el('span', 'face face--initial', name.slice(0, 1));
    if (info.r) span.classList.add(`rank-${info.r}`);
    return span;
  }

  /** 日ビュー用チップ（アイコン + 名前、ランク色枠）。タップで紹介ポップアップ */
  function castChip(name, date) {
    const info = castInfo(name);
    const chip = el('button', 'chip');
    chip.type = 'button';
    chip.classList.add(info.r ? `rank-${info.r}` : 'rank-normal');
    chip.append(castFace(name));
    chip.append(el('span', 'chip__name', name));
    chip.addEventListener('click', () => openCastPopup(name, date));
    return chip;
  }

  // ---------- キャスト紹介ポップアップ ----------
  const castPop = document.getElementById('castPop');
  const castPopCard = document.getElementById('castPopCard');

  /**
   * その日のスロット列から name の出勤レンジ表記を作る（連続スロットを結合）。
   * 終了時刻は最終スロットの +1時間（例: 23:00 のみ → "23:00〜24:00"、
   * 0:00〜3:00 連続 → "0:00〜4:00"。スロットは1時間刻み・raw表記が前提）
   */
  function shiftRangeLabel(slots, name) {
    const runs = [];
    let last = -2;
    slots.forEach((slot, i) => {
      if (!slot.n.includes(name)) return;
      if (i === last + 1) runs[runs.length - 1].end = i;
      else runs.push({ start: i, end: i });
      last = i;
    });
    return runs.map(({ start, end }) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(slots[end].t);
      const endLabel = m ? `${Number(m[1]) + 1}:${m[2]}` : slots[end].t;
      return `${slots[start].t}〜${endLabel}`;
    }).join(' / ');
  }

  function openCastPopup(name, date) {
    const info = castInfo(name);
    const day = dayByDate.get(date);
    const ranked = !!(info.p && info.r); // ランク意匠はプロフィールがある場合のみ
    castPopCard.textContent = '';
    castPopCard.className = 'profile-card'
      + (info.r ? ` rank-${info.r}` : '')
      + (ranked ? ' ranked' : '');
    if (ranked) {
      castPopCard.append(el('div', 'pr-frame'));
      castPopCard.append(el('span', 'pr-watermark', info.r.toUpperCase()));
    }
    if (info.i) {
      const img = el('img', 'cast-icon');
      img.src = info.i;
      img.alt = name;
      castPopCard.append(img);
    } else {
      castPopCard.append(el('span', 'cast-icon cast-icon--initial', name.slice(0, 1)));
    }
    castPopCard.append(el('p', `cast-name${ranked ? ' pr-name' : ''}`, name));
    if (info.r) {
      castPopCard.append(el('p', `rank-badge rank-${info.r}`, `${info.r.toUpperCase()} CLASS`));
    }
    const ranges = day ? shiftRangeLabel(day.slots, name) : '';
    if (ranges) castPopCard.append(el('span', 'shift-badge', `この日の出勤 ${ranges}`));
    if (info.p && info.p.catch) {
      castPopCard.append(el('p', `profile-catch${ranked ? ' pr-catch' : ''}`, info.p.catch));
    }
    if (info.app) {
      // BackStage アプリのキャストページへの Deeplink（未インストール時はストア）
      const a = el('a', 'btn-primary app-link', 'アプリで会いにいく');
      a.href = info.app;
      a.target = '_blank';
      a.rel = 'noopener';
      castPopCard.append(a);
    }
    if (info.tags && info.tags.length) {
      const wrap = el('div', 'match-tags');
      for (const t of info.tags) wrap.append(el('span', 'match-tag', t));
      castPopCard.append(wrap);
    }
    if (info.specs && info.specs.length) {
      const list = el('dl', 'spec-list');
      for (const s of info.specs) {
        list.append(el('dt', 'spec-label', s.label));
        list.append(el('dd', 'spec-value', s.value));
      }
      castPopCard.append(list);
    }
    if (info.p && info.p.intro) {
      castPopCard.append(el('p', 'profile-intro', info.p.intro));
    }
    if (info.x) {
      const x = el('a', 'cast-cta', 'X（旧Twitter）を見る →');
      x.href = info.x;
      x.target = '_blank';
      x.rel = 'noopener';
      castPopCard.append(x);
    }
    castPop.hidden = false;
    document.body.classList.add('pop-open');
    castPopCard.scrollTop = 0;
  }

  function closeCastPopup() {
    castPop.hidden = true;
    document.body.classList.remove('pop-open');
  }

  castPop.addEventListener('click', (e) => {
    if (e.target === castPop) closeCastPopup();
  });
  document.getElementById('castPopClose').addEventListener('click', closeCastPopup);

  // ---------- ライトボックス（画像の拡大表示） ----------
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');

  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.hidden = false;
    document.body.classList.add('lightbox-open');
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.classList.remove('lightbox-open');
  }

  document.getElementById('schedImg').addEventListener('click', (e) => {
    openLightbox(e.currentTarget.src);
  });
  lightbox.addEventListener('click', closeLightbox);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!lightbox.hidden) closeLightbox();
    else if (!castPop.hidden) closeCastPopup();
  });

  // ---------- 起動 ----------
  navigate(params.get('date'), true);
})();
