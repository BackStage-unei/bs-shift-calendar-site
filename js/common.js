/* =============================================================
 * common.js — 日付・時刻ユーティリティ（フレームワーク非依存の純関数）
 *
 * 日付は常に "YYYY-MM-DD" 文字列で扱う。
 * `new Date("YYYY-MM-DD")` のローカル解釈ずれを避けるため、
 * Date は必ず Date.UTC 経由で組み立てる。
 * ============================================================= */

/** 日本時間での今日を "YYYY-MM-DD" で返す */
function todayJST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/** "YYYY-MM-DD" → [year, month, day]（数値） */
function dateParts(s) {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

/** "YYYY-MM-DD" に日数を加算 */
function addDays(s, n) {
  const [y, m, d] = dateParts(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 曜日番号（0=月 〜 6=日）。shift-manager と同じ月曜始まり */
function weekdayIndex(s) {
  const [y, m, d] = dateParts(s);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** その日を含む週の月曜日を返す（データ週の単位。shift-manager と同じ） */
function weekStartOf(s) {
  return addDays(s, -weekdayIndex(s));
}

/** その日を含む「日曜始まりの週」の日曜日を返す（月カレンダー表示用） */
function sundayStartOf(s) {
  return addDays(s, -((weekdayIndex(s) + 1) % 7));
}

/**
 * "YYYY-MM-DD" の形で、しかも実在する日付かどうか（URL の ?date= の確認用）。
 * 例: "2026-10-14" → true / "2026-02-30" や "abc" → false
 */
function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return addDays(s, 0) === s; // 2/30 などは Date が繰り上げるので一致しなくなる
}

/**
 * その日を含む週（月曜〜日曜。データ週と同じ区切り）の [月曜, 日曜] を返す。
 * 例: "2026-10-14"（水） → ["2026-10-12", "2026-10-18"]
 */
function weekRangeOf(s) {
  const monday = weekStartOf(s);
  return [monday, addDays(monday, 6)];
}

/** ["2026-10-12", "2026-10-18"] → "2026.10.12 - 2026.10.18"（「今週のシフト」の期間表示） */
function formatRangeDots(range) {
  return `${range[0].replaceAll('-', '.')} - ${range[1].replaceAll('-', '.')}`;
}

/**
 * 他のページ（STUDIO など）の iframe の中で表示されているかどうか。
 * 親ページを調べられない（例外が出る）環境も、埋め込みとして扱う。
 */
function isEmbedded(win) {
  try {
    return win.self !== win.top;
  } catch (e) {
    return true;
  }
}

/**
 * 日ビューを全画面で開くための URL を作る。
 * 今の URL から theme と bg だけを引き継ぎ、date を付ける（それ以外のパラメータは捨てる）。
 * 例: ".../?theme=luxe&bg=veil" + "2026-10-14" → ".../?theme=luxe&bg=veil&date=2026-10-14"
 */
function dayPageHref(currentHref, date) {
  const current = new URL(currentHref);
  const out = new URL(currentHref);
  out.search = '';
  out.hash = '';
  for (const key of ['theme', 'bg']) {
    const value = current.searchParams.get(key);
    if (value !== null) out.searchParams.set(key, value);
  }
  out.searchParams.set('date', date);
  return out.toString();
}

const WEEKDAY_JA = ['月', '火', '水', '木', '金', '土', '日'];
const WEEKDAY_EN = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** "2026-07-21" → "7/21（火）" */
function formatDateJa(s) {
  const [, m, d] = dateParts(s);
  return `${m}/${d}（${WEEKDAY_JA[weekdayIndex(s)]}）`;
}

/** "2026-07" → "2026年7月" */
function formatMonthJa(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

/** "YYYY-MM"（月キー）を n ヶ月ずらす */
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

/**
 * 夜順スロットの時刻ラベル変換（scripts/shiftcal_lib.py の time_labels と同仕様）。
 * - raw（デフォルト）: 素の表記のまま（0:00〜3:00）。実X画像と同じ表記
 *   であることを 2026-07-23 に実データと突合して確定済み。
 * - plus24: 折り返し以降を +24 表記（例: 0:00 → 24:00）。
 * 変更時は Python 側も合わせること。
 */
function timeLabels(slotTimes, style = 'raw') {
  if (style === 'raw') return [...slotTimes];
  const labels = [];
  let firstHour = null;
  let wrapped = false;
  for (const t of slotTimes) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    if (!m) { labels.push(t); continue; }
    const hour = Number(m[1]);
    if (firstHour === null) firstHour = hour;
    else if (hour < firstHour) wrapped = true;
    labels.push(`${wrapped ? hour + 24 : hour}:${m[2]}`);
  }
  return labels;
}

/** createElement ヘルパー（テキストは常に textContent 経由 = XSS安全） */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
