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
 * 埋め込み（iframe の中）では日ビューを出さない。日付をタップすると
 * target="_top" のリンクで、枠の外（トップレベル）に日ビューを全画面で開く。
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

  // ---------- 埋め込み判定 ----------
  // STUDIO の埋め込み枠は高さが px 固定（PC 950・スマホ 900）で、日ビューは枠に収まらない。
  // 枠の中で日ビューを出すと iPhone でスクロールが取り合いになるため、
  // 埋め込みの中では日ビューを出さず、日付のタップで「全画面（トップレベル）」の日ビューを開く。
  const EMBEDDED = isEmbedded(window);
  if (EMBEDDED) {
    // 埋め込みの中ではスクロールさせない（指がどこにあっても STUDIO のページだけが動くように）。
    // 中身は枠の高さに収まる前提。枠を低くすると下が切れるので、枠の高さを変えたら必ず確認する
    document.documentElement.dataset.embedded = '1';
    // 「← カレンダー」で STUDIO に戻ると、iPhone の Safari はページを覚えたまま復元する。
    // そのとき枠の中だけタップもスクロールも効かなくなる（2回タップで反応する）ことがあるため、
    // 復元されたら枠の中のカード・カレンダーを作り直す（読み込み直すと枠の中がちらつくので、同じ中身をその場で差し替える）。
    // 横スクロールの位置はそのまま
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      const strip = document.getElementById('weekStrip');
      const left = strip.scrollLeft;
      renderTop();
      strip.scrollLeft = left;
    });
  }

  // 埋め込みから全画面で開いたか（dayPageHref が付ける from=studio）。戻り先は STUDIO のスケジュールページ
  const STUDIO_SCHEDULE_URL = 'https://violet591727.studio.site/Schedule';
  const FROM_STUDIO = !EMBEDDED && params.get('from') === 'studio';
  // 直前のページが「埋め込みの中のカレンダー」（同じサイト）なら、履歴を戻れば STUDIO のページに着く
  let cameFromEmbed = false;
  try {
    cameFromEmbed = FROM_STUDIO && !!document.referrer && new URL(document.referrer).origin === location.origin;
  } catch (e) {
    cameFromEmbed = false;
  }

  /**
   * STUDIO のスケジュールページへ戻る。
   * 埋め込みから来たときは「ブラウザの戻る」と同じ動き（history.go）にする。
   * ブラウザが STUDIO のページを覚えていれば読み込み直さずに戻れる（点滅しない・スクロール位置もそのまま）。
   * 共有リンクなどで直接開いたとき、または戻れなかったときは、STUDIO のページへ移動する。
   */
  // 戻る途中か。連打で history.go が重なると STUDIO より前のページまで戻ってしまうので、1回だけ受け付ける（qa7 P1）。
  // 戻る・進むでこのページが復元されたら、また押せるように戻す
  let leaving = false;
  window.addEventListener('pageshow', () => { leaving = false; });

  function backToStudio() {
    if (leaving) return;
    leaving = true;
    const depth = history.state && Number.isInteger(history.state.depth) ? history.state.depth : null;
    if (!cameFromEmbed || depth === null || history.length < depth + 2) {
      location.assign(STUDIO_SCHEDULE_URL);
      return;
    }
    // 戻れずに残っていたときの保険。ページを離れたら取り消す（戻る・進むで復元されたときに誤って動かないように）
    const fallback = setTimeout(() => location.assign(STUDIO_SCHEDULE_URL), 1500);
    window.addEventListener('pagehide', () => clearTimeout(fallback), { once: true });
    history.go(-(depth + 1));
  }

  // 背景モード（埋め込み先に馴染ませる）: ?bg=clear（完全透過） / ?bg=veil（半透明ベール）
  // 埋め込みの中でだけ効かせる。全画面で開いた日ビューは、通常の濃い背景にする
  const bgMode = params.get('bg');
  if (EMBEDDED && (bgMode === 'clear' || bgMode === 'veil')) {
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
        // depth: このページに来てから pushState で積んだ数（「← カレンダー」で STUDIO まで戻る段数に使う）
        const cur = (history.state && history.state.depth) || 0;
        const depth = replace ? cur : cur + 1;
        history[replace ? 'replaceState' : 'pushState']({ date, depth }, '', url);
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
    // 埋め込みの中では日ビューを出さない（?date= 付きで読み込まれても最初の画面）
    if (!EMBEDDED && date && dayByDate.has(date)) {
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

  /**
   * 日ビューへ移る部品（ストリップのカード・カレンダーの日付）を作る。
   * - 普通に開いたとき: ボタン。押すとページ内で日ビューに切り替える
   * - 埋め込みの中: リンク（target="_top"）。押すと枠の外＝トップレベルで日ビューを開く
   *   （JS で top.location を書き換える方式は STUDIO の sandbox で失敗しやすいので使わない）
   */
  function dayOpener(className, date) {
    if (EMBEDDED) {
      const a = el('a', className);
      a.href = dayPageHref(location.href, date);
      a.target = '_top';
      return a;
    }
    const btn = el('button', className);
    btn.type = 'button';
    btn.addEventListener('click', () => navigate(date));
    return btn;
  }

  function renderTop() {
    const strip = document.getElementById('weekStrip');
    strip.textContent = '';

    const focus = stripFocusDate();
    // 「今週のシフト」の期間 = ストリップの中心に置く日（今日。公開データが無ければ最寄りの公開日）を含む週
    document.getElementById('weekRangeEn').textContent =
      focus ? formatRangeDots(weekRangeOf(focus)) : '';

    // 公開済みの全日を1本のスライダーとして並べる（過去週へもスワイプで遡れる）
    for (const date of allDates) {
      const day = dayByDate.get(date);
      const card = dayOpener('week__day', date);
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
      const cell = day ? dayOpener('cal__cell', d) : el('div', 'cal__cell');
      if (!inMonth) cell.classList.add('is-out');
      if (d === TODAY) cell.classList.add('is-today');
      cell.append(el('span', 'cal__daynum', String(Number(d.slice(8)))));
      if (day) {
        cell.classList.add('has-data');
        cell.append(el('span', 'cal__count', `${castsOfDay(day).length}名`));
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
    document.getElementById('dayBack').onclick = () => {
      // 公式サイトの埋め込みから全画面で開いたときは、github.io の最初の画面ではなく STUDIO のスケジュールページへ戻す
      if (FROM_STUDIO) backToStudio();
      else navigate(null);
    };

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
    // ランク勢は額縁(pr-frame)をコンテンツ全高に追従させるため、スクロールする
    // カード直下ではなく内側ラッパー(pr-inner)に額縁ごと入れる
    const body = ranked ? el('div', 'pr-inner') : castPopCard;
    if (ranked) {
      body.append(el('div', 'pr-frame'));
      body.append(el('span', 'pr-watermark', info.r.toUpperCase()));
      castPopCard.append(body);
    }
    if (info.i) {
      const img = el('img', 'cast-icon');
      img.src = info.i;
      img.alt = name;
      body.append(img);
    } else {
      body.append(el('span', 'cast-icon cast-icon--initial', name.slice(0, 1)));
    }
    body.append(el('p', `cast-name${ranked ? ' pr-name' : ''}`, name));
    if (info.r) {
      body.append(el('p', `rank-badge rank-${info.r}`, `${info.r.toUpperCase()} CLASS`));
    }
    const ranges = day ? shiftRangeLabel(day.slots, name) : '';
    if (ranges) body.append(el('span', 'shift-badge', `この日の出勤 ${ranges}`));
    if (info.p && info.p.catch) {
      body.append(el('p', `profile-catch${ranked ? ' pr-catch' : ''}`, info.p.catch));
    }
    if (info.app) {
      // BackStage アプリのキャストページへの Deeplink（未インストール時はストア）
      const a = el('a', 'btn-primary app-link', 'アプリで会いにいく');
      a.href = info.app;
      a.target = '_blank';
      a.rel = 'noopener';
      body.append(a);
    }
    if (info.tags && info.tags.length) {
      const wrap = el('div', 'match-tags');
      for (const t of info.tags) wrap.append(el('span', 'match-tag', t));
      body.append(wrap);
    }
    if (info.specs && info.specs.length) {
      const list = el('dl', 'spec-list');
      for (const s of info.specs) {
        list.append(el('dt', 'spec-label', s.label));
        list.append(el('dd', 'spec-value', s.value));
      }
      body.append(list);
    }
    if (info.p && info.p.intro) {
      body.append(el('p', 'profile-intro', info.p.intro));
    }
    if (info.x) {
      const x = el('a', 'cast-cta', 'X（旧Twitter）を見る →');
      x.href = info.x;
      x.target = '_blank';
      x.rel = 'noopener';
      body.append(x);
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
  // 埋め込みの中、または ?date= が公開データに無い日・不正な値のときは、最初の画面を出して
  // URL からも date を外す（壊れた ?date= が残らないように）
  const startDate = params.get('date');
  navigate(!EMBEDDED && isDateStr(startDate) && dayByDate.has(startDate) ? startDate : null, true);
})();
