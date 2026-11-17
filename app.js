// =============================================================
// 검정고시 연습 퀴즈 - 동작 코드
// 흐름: 설정 불러오기 → 홈(과목) → 과목(단원·약점) → 퀴즈 → 결과
// 문제 종류: 4지선다(기본), 흐름(사건 순서 배열, type: "order")
// =============================================================

// 버전: index.html에 적은 app.js?v=숫자를 그대로 읽어와요.
// 데이터 파일(config.json, history.json)을 받을 때도 이 숫자를 붙여서,
// 사이트를 고친 뒤 옛날 데이터가 섞여 나오는 걸 막아요. 숫자는 index.html 한 곳에서만 바꾸면 돼요.
const APP_VERSION = (() => {
  try {
    return new URL(document.currentScript.src).searchParams.get("v") || "dev";
  } catch (e) {
    return "dev";
  }
})();
const withVersion = (url) => url + (url.includes("?") ? "&" : "?") + "v=" + APP_VERSION;

// 어디서든 예상 못 한 오류가 나면 빈 화면 대신 안내를 보여줘요.
// 사용자는 왜 멈췄는지 모르면 그냥 떠나요. 무엇을 하면 되는지 알려주는 게 중요해요.
function showError() {
  const banner = document.getElementById("error-banner");
  if (banner) banner.hidden = false;
}
window.addEventListener("error", showError);
window.addEventListener("unhandledrejection", showError);

// 한 번 퀴즈를 시작했을 때 풀 문제 수.
// 너무 많으면 지쳐서 중간에 나가요. 10문제면 5분 안쪽이라 부담이 적어요.
const QUESTIONS_PER_ROUND = 10;

// 복습은 밀린 게 많아도 한 번에 20문제까지만. 너무 많으면 시작할 엄두가 안 나요.
const REVIEW_PER_ROUND = 20;

// 약점이라고 판단하려면 그 단원에서 최소 몇 문제는 풀어봐야 해요.
// 1~2문제로 "약점"이라고 하면 우연히 틀린 걸 약점으로 오해하게 돼요.
const MIN_SEEN_FOR_WEAK = 3;

// 간격 반복: 틀린 문제를 1일 → 3일 → 7일 뒤에 다시 내줘요.
// 사람은 잊어버리기 직전에 다시 볼 때 가장 오래 기억해요.
// 세 번 연속으로 제때 맞히면 "이제 안다"고 보고 복습 목록에서 빼요.
const REVIEW_GAPS = [1, 3, 7];

// 프로그램이 "지금 어떤 상태인지" 기억하는 곳이에요.
// 화면을 그릴 때 항상 여기 값을 보고 그려요.
const state = {
  config: null,      // config.json 내용 (과목 목록, 링크들)
  cache: {},         // 과목별로 불러온 문제 (한 번 불러오면 다시 안 불러와요)
  subject: null,     // 지금 보고 있는 과목
  questions: [],     // 이번 판에 풀 문제들
  index: 0,          // 몇 번째 문제를 보고 있는지 (0부터 셈)
  correctCount: 0,   // 맞힌 개수
  roundWrong: [],    // 이번 판에서 틀린 문제들 (결과 화면에 보여줄 용도)
  answered: false,   // 지금 문제에 답을 했는지
  picked: [],        // 흐름 문제에서 지금까지 누른 사건들 (순서대로)
  mode: "all",       // "all" 전체 | "unit" 단원 | "wrong" 오답노트 | "review" 복습 | "flow" 흐름
  unit: null,        // 단원 모드일 때 고른 단원 이름
};

const MODE_LABEL = { all: "전체 범위", unit: "", wrong: "오답노트", review: "오늘의 복습", flow: "흐름 문제", today: "오늘의 학습", again: "틀린 문제 다시" };

// 하루 목표로 고를 수 있는 문제 수. 기본은 20문제(약 10분).
const DAILY_GOALS = [10, 20, 30, 50];
const DEFAULT_GOAL = 20;

// -------------------------------------------------------------
// 브라우저 저장소(localStorage) 도우미
// 서버 없이 사용자 기기 안에 기록을 저장해요.
// 사생활 보호 모드 등에서는 저장소가 막힐 수 있어서
// try/catch로 감싸 두었어요. 막혀도 퀴즈 자체는 돌아가게요.
// -------------------------------------------------------------
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* 저장이 안 돼도 조용히 넘어가요 */
  }
}

// 오답노트: 틀린 문제 id 목록
const getWrongIds = (subjectId) => load("wrong:" + subjectId, []);
const setWrongIds = (subjectId, ids) => save("wrong:" + subjectId, ids);

// 풀이 기록: { 문제id: 1(맞힘) 또는 0(틀림) } — 각 문제의 "가장 최근" 결과만 기억해요.
// 누적 점수가 아니라 최근 결과를 쓰는 이유: 예전에 틀렸어도 지금 맞히면
// 이제 아는 거니까, 약점 지도가 "지금의 실력"을 보여줘야 해요.
const getSeen = (subjectId) => load("seen:" + subjectId, {});
const setSeen = (subjectId, seen) => save("seen:" + subjectId, seen);

// 복습 일정: { 문제id: { step: 몇 번째 간격인지(0,1,2), due: "다시 볼 날짜" } }
const getReview = (subjectId) => load("review:" + subjectId, {});
const setReview = (subjectId, review) => save("review:" + subjectId, review);

// -------------------------------------------------------------
// 날짜 도우미
// 날짜를 "2026-11-17" 같은 글자로 저장하면, 글자끼리 크기 비교만으로
// 어느 날이 먼저인지 알 수 있어요("2026-11-09" < "2026-11-17").
// -------------------------------------------------------------
function dateKey(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
const todayKey = () => dateKey(new Date());
function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateKey(d);
}
// 1970년 1월 1일부터 오늘이 며칠째인지. '오늘의 한마디'를 고를 때 써요.
function dayNumber() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

// 오늘 푼 문제 수 (과목 상관없이). 날짜가 바뀌면 새 칸에 세서 자동으로 0부터 시작해요.
const getDoneToday = () => load("done:" + todayKey(), 0);
const getGoal = () => load("dailyGoal", DEFAULT_GOAL);

// 지정한 날짜(포함)까지 복습할 문제
function dueIdsBy(subjectId, day) {
  const review = getReview(subjectId);
  return Object.keys(review).filter((id) => review[id].due <= day);
}

function dueIds(subjectId) {
  const review = getReview(subjectId);
  const today = todayKey();
  return Object.keys(review).filter((id) => review[id].due <= today);
}

// -------------------------------------------------------------
// 작은 도구들
// -------------------------------------------------------------
const $ = (id) => document.getElementById(id);

// 사용자에게 보여줄 글자를 HTML에 넣을 때 쓰는 안전장치.
// 문제 글에 < 같은 기호가 있어도 태그로 오해받지 않게 바꿔요.
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// 배열 섞기 (피셔-예이츠 셔플).
// 문제 순서와 보기 순서를 매번 섞어서, "3번이 정답이었지" 하고
// 위치로 외우는 걸 막아요.
function shuffle(list) {
  const arr = list.slice(); // 원본을 건드리지 않도록 복사
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 흐름 문제를 섞을 때는 "이미 정답 순서인" 경우를 피해요. 그대로 누르면 맞는 건 문제가 아니니까요.
function shuffleNotSorted(list) {
  let arr = shuffle(list);
  for (let tries = 0; tries < 10 && arr.every((x, i) => x === list[i]); tries++) arr = shuffle(list);
  return arr;
}

const percent = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100));
const isOrder = (q) => q.type === "order";
const answerText = (q) => (isOrder(q) ? q.items.join(" → ") : q.choices[q.answer]);

// 화면 전환: 보여줄 화면 하나만 켜고 나머지는 숨겨요.
function showScreen(name) {
  ["home", "subject", "quiz", "result"].forEach((s) => {
    $("screen-" + s).hidden = s !== name;
  });
  window.scrollTo(0, 0);
}

// 과목의 문제 파일 불러오기. 한 번 불러온 건 cache에 보관해요.
// 같은 파일을 화면 바뀔 때마다 다시 받으면 느리고 데이터도 낭비돼요.
async function loadQuestions(subject) {
  if (!state.cache[subject.id]) {
    const res = await fetch(withVersion(subject.file));
    if (!res.ok) throw new Error("문제 파일 없음: " + subject.file);
    state.cache[subject.id] = await res.json();
  }
  return state.cache[subject.id];
}

// -------------------------------------------------------------
// 통계 계산: 단원별로 몇 문제 풀고 몇 개 맞혔는지
// -------------------------------------------------------------
function computeStats(subject, questions) {
  const seen = getSeen(subject.id);
  const units = (subject.units || []).map((u) => {
    const qs = questions.filter((q) => q.unit === u.name);
    const tried = qs.filter((q) => q.id in seen);
    const correct = tried.filter((q) => seen[q.id] === 1).length;
    return {
      name: u.name,
      range: u.range,
      total: qs.length,
      seen: tried.length,
      correct,
      rate: percent(correct, tried.length),
    };
  });

  // 약점 단원: 충분히 풀어본 단원 중 정답률이 가장 낮은 곳 (80% 미만일 때만)
  const candidates = units.filter((u) => u.seen >= MIN_SEEN_FOR_WEAK && u.rate < 80);
  candidates.sort((a, b) => a.rate - b.rate);

  const seenTotal = units.reduce((s, u) => s + u.seen, 0);
  const correctTotal = units.reduce((s, u) => s + u.correct, 0);
  return {
    units,
    weak: candidates[0] || null,
    seenTotal,
    total: questions.length,
    rate: percent(correctTotal, seenTotal),
    flowCount: questions.filter(isOrder).length,
  };
}

// -------------------------------------------------------------
// D-day
// -------------------------------------------------------------
function renderDday() {
  const date = load("examDate", "");
  const el = $("dday");
  $("exam-date-input").value = date;
  if (!date) {
    el.textContent = "시험일 설정";
    el.classList.add("empty");
    return;
  }
  // 날짜끼리 빼면 밀리초 차이가 나와요. 하루 = 86,400,000 밀리초.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = new Date(date + "T00:00:00");
  const days = Math.round((exam - today) / 86400000);
  el.classList.remove("empty");
  el.textContent = days > 0 ? "D-" + days : days === 0 ? "오늘이 시험일!" : "시험이 끝났어요";
}

// 오늘 복습 카드: 홈과 과목 화면에서 같은 모양으로 써요.
function reviewCardHtml(subjectName, count) {
  return (
    '<div class="review-text"><strong>오늘 복습할 문제 ' + count + "개</strong>" +
    "<small>" + escapeHtml(subjectName) + " · 잊어버리기 전에 다시 보면 오래 기억해요</small></div>" +
    '<span class="primary go-btn">복습하기</span>'
  );
}

// -------------------------------------------------------------
// 오늘의 한마디
// 날짜 번호를 명언 개수로 나눈 나머지 번째 문장을 보여줘요.
// 서버 없이도 같은 날엔 모두 같은 문장, 자정이 지나면 다음 문장이 나와요.
// -------------------------------------------------------------
function renderQuote() {
  const quotes = state.quotes || [];
  if (!quotes.length) return;
  const q = quotes[dayNumber() % quotes.length];
  $("quote-text").textContent = q.text;
  // 지은이가 있으면 "— 공자, 『논어』" 처럼, 없으면(직접 쓴 문장) 비워둬요.
  $("quote-author").textContent = q.author
    ? "— " + q.author + (q.source ? ", " + q.source : "")
    : "";
  $("quote-card").hidden = false;
}

// -------------------------------------------------------------
// 오늘의 학습 계획 세우기
// 목표 문제 수(사용자가 정함) 안을 무엇으로 채울지 사이트가 추천해요.
//   1순위: 오늘 복습할 문제 (잊어버리기 직전이라 가장 효과가 커요)
//   2순위: 추천 단원의 새 문제 (약점 단원 → 없으면 가장 덜 푼 단원)
// -------------------------------------------------------------
function pickUnit(st, except) {
  const open = st.units.filter((u) => u.seen < u.total && u.name !== except);
  if (!open.length) return null;
  if (st.weak && st.weak.name !== except && st.weak.seen < st.weak.total) return st.weak;
  // 진도 비율이 가장 낮은 단원. 같으면 앞 단원(시대순)부터.
  return open.slice().sort((a, b) => a.seen / a.total - b.seen / b.total)[0];
}

// 한 과목 안에서 새 문제 count개를 어느 단원에서 낼지 정해요.
// 추천 단원(약점 → 덜 푼 단원)부터 채우고, 그 단원에 남은 문제가 모자라면 다음 단원으로 넘겨요.
// (예전엔 30문제짜리 단원에 '새 문제 50개'라고 나오는 버그가 있었어요.)
function fillUnits(st, count) {
  const parts = [];
  let need = count;
  const used = new Set();
  let u = pickUnit(st);
  while (need > 0 && u) {
    const take = Math.min(u.total - u.seen, need);
    if (take > 0) parts.push({ unit: u, count: take });
    need -= take;
    used.add(u.name);
    u = st.units
      .filter((x) => !used.has(x.name) && x.seen < x.total)
      .sort((a, b) => a.seen / a.total - b.seen / b.total)[0];
  }
  return parts;
}

// -------------------------------------------------------------
// 내 시험 과목: 오늘의 학습에 섞어 넣을 과목들.
// 처음엔 문제가 있는 과목 전부. 사용자가 끄고 켤 수 있어요(최소 1과목).
// -------------------------------------------------------------
function readySubjects() {
  return state.config.subjects.filter((s) => s.file);
}
function getMySubjects() {
  const ready = readySubjects();
  const saved = load("mySubjects", null);
  const mine = Array.isArray(saved) ? ready.filter((s) => saved.includes(s.id)) : [];
  return mine.length ? mine : ready;
}

// -------------------------------------------------------------
// 여러 과목 계획 세우기
//   1순위: 모든 과목의 오늘 복습할 문제
//   2순위: 남은 목표를 과목들에 고르게 나눈 새 문제
// 고르게 나누는 방법: 한 문제씩 과목을 돌아가며 배정해요(카드 나눠주듯이).
// 시작 과목은 날짜마다 바뀌어서, 매일 같은 과목만 먼저 나오지 않아요.
// -------------------------------------------------------------
function makePlan(entries) {
  const goal = getGoal();
  const done = getDoneToday();
  const remaining = Math.max(goal - done, 0);

  let left = remaining;
  const reviewParts = [];
  entries.forEach((e) => {
    const due = dueIds(e.subject.id).length;
    const take = Math.min(due, left);
    if (take > 0) reviewParts.push({ subject: e.subject, count: take });
    left -= take;
  });

  // 과목별 '아직 안 푼 문제 수'까지만 배정할 수 있어요.
  const share = entries.map(() => 0);
  const cap = entries.map((e) => e.st.total - e.st.seenTotal);
  const n = entries.length;
  let i = n ? dayNumber() % n : 0;
  let idle = 0;
  while (left > 0 && n && idle < n) {
    if (share[i] < cap[i]) { share[i]++; left--; idle = 0; } else idle++;
    i = (i + 1) % n;
  }
  const newParts = [];
  entries.forEach((e, k) => {
    fillUnits(e.st, share[k]).forEach((p) => newParts.push({ subject: e.subject, st: e.st, unit: p.unit, count: p.count }));
  });

  const reviewPart = reviewParts.reduce((sum, p) => sum + p.count, 0);
  const newPart = newParts.reduce((sum, p) => sum + p.count, 0);
  return { goal, done, remaining, reviewParts, reviewPart, newParts, newPart };
}

function renderToday(entries) {
  const plan = makePlan(entries);
  state.todayPlan = plan;
  const multi = entries.length > 1;
  const tag = (subject) => (multi ? '<span class="plan-subject">' + escapeHtml(subject.name) + "</span> " : "");

  $("today-count").textContent = Math.min(plan.done, plan.goal) + " / " + plan.goal + "문제";
  const bar = $("today-bar");
  bar.style.width = Math.min(100, percent(plan.done, plan.goal)) + "%";
  bar.classList.toggle("done", plan.remaining === 0);

  // 오늘 할 일 목록. 과목이 여러 개면 줄마다 과목 이름을 앞에 붙여요.
  const items = [];
  if (plan.remaining === 0) {
    items.push('<li class="done-msg">오늘 목표 달성! 더 풀면 내일이 더 가벼워져요.</li>');
  } else {
    plan.reviewParts.forEach((p) => items.push("<li>" + tag(p.subject) + "복습 " + p.count + "문제</li>"));
    plan.newParts.forEach((p) => {
      const why = p.st.weak && p.unit.name === p.st.weak.name ? " (약점 단원)" : "";
      items.push("<li>" + tag(p.subject) + "새 문제 " + p.count + "개 · " + escapeHtml(p.unit.name) + why + "</li>");
    });
    if (!items.length) items.push("<li>고른 과목의 문제를 모두 한 번씩 풀었어요! 과목을 눌러 전체 범위로 다시 다져보세요.</li>");
  }
  $("today-plan").innerHTML = items.join("");

  const start = $("today-start");
  const nothing = plan.reviewPart + plan.newPart === 0;
  start.hidden = plan.remaining > 0 && nothing;
  start.textContent = plan.remaining === 0 ? "한 판 더 풀기" : plan.done === 0 ? "오늘 계획대로 시작" : "이어서 하기";
  start.onclick = () => {
    if (plan.remaining === 0) {
      // 목표를 채웠으면 계획 대신, 고른 과목 중 하나(날마다 바뀜)에서 한 판 더.
      state.subject = entries[dayNumber() % entries.length].subject;
      startQuiz("all");
    } else startQuiz("today");
  };

  // 내일 미리보기: 내일까지 쌓일 복습 문제 수 (모든 고른 과목 합계)
  const tomorrowDue = entries.reduce((sum, e) => sum + dueIdsBy(e.subject.id, addDays(1)).length, 0);
  $("tomorrow-text").textContent = tomorrowDue > 0
    ? "내일은 복습 " + tomorrowDue + "문제부터 시작해요."
    : "틀린 문제는 다음 날 복습으로 다시 나와요.";

  // 설정 열기/닫기: 평소엔 "하루 20문제 · 4과목 · 변경" 한 줄만 보여요.
  const toggle = $("goal-toggle");
  toggle.textContent = "하루 " + plan.goal + "문제 · " + entries.length + "과목 · " + (state.goalOpen ? "닫기" : "변경");
  toggle.setAttribute("aria-expanded", String(Boolean(state.goalOpen)));
  toggle.onclick = () => {
    state.goalOpen = !state.goalOpen;
    renderToday(entries);
  };
  $("goal-row").hidden = !state.goalOpen;

  // 목표 고르기 칩
  const chips = $("goal-chips");
  chips.innerHTML = "";
  DAILY_GOALS.forEach((g) => {
    const chip = document.createElement("button");
    chip.className = "goal-chip" + (g === plan.goal ? " on" : "");
    chip.textContent = g + "문제";
    chip.setAttribute("aria-label", "하루 " + g + "문제");
    chip.addEventListener("click", () => {
      save("dailyGoal", g);
      renderToday(entries);
    });
    chips.appendChild(chip);
  });

  // 내 시험 과목 칩: 눌러서 켜고 끄기. 마지막 한 과목은 끌 수 없어요(계획이 비면 안 되니까요).
  const mine = getMySubjects().map((s) => s.id);
  const sChips = $("subject-chips");
  sChips.innerHTML = "";
  readySubjects().forEach((s) => {
    const on = mine.includes(s.id);
    const chip = document.createElement("button");
    chip.className = "goal-chip" + (on ? " on" : "");
    chip.textContent = s.name;
    chip.setAttribute("aria-pressed", String(on));
    chip.addEventListener("click", () => {
      const next = on ? mine.filter((id) => id !== s.id) : mine.concat(s.id);
      if (!next.length) return;
      save("mySubjects", next);
      renderHome();
    });
    sChips.appendChild(chip);
  });

  $("today-card").hidden = false;
}

// -------------------------------------------------------------
// 1. 홈 화면
// -------------------------------------------------------------
async function renderHome() {
  const ready = readySubjects();
  const soon = state.config.subjects.filter((s) => !s.file);

  showScreen("home");
  renderDday();

  // 준비 중인 과목: 누를 수 없으니 버튼이 아니라 작은 글자 칩으로.
  $("soon-list").textContent = soon.length
    ? soon.map((s) => s.name).join(" · ") + " 과목은 준비 중이에요."
    : "";

  renderQuote();

  // 풀 수 있는 과목: 카드 전체가 버튼이에요. 어디를 눌러도 과목 화면으로 가요.
  const readyList = $("ready-list");
  readyList.innerHTML = "";
  let questionCount = 0;
  // 오늘의 학습은 '내 시험 과목' 전체를 보고 계획해요.
  const mineIds = getMySubjects().map((s) => s.id);
  const entries = [];
  for (const subject of ready) {
    let summary = "";
    try {
      const qs = await loadQuestions(subject);
      questionCount += qs.length;
      const st = computeStats(subject, qs);
      summary = st.seenTotal
        ? st.seenTotal + "/" + st.total + "문제 풀이 · 정답률 " + st.rate + "%"
        : st.total + "문제" + (st.flowCount ? " · 흐름 문제 " + st.flowCount + "개" : "");

      if (mineIds.includes(subject.id)) entries.push({ subject, st });
    } catch (e) {
      summary = "문제를 불러오지 못했어요";
    }

    const card = document.createElement("button");
    card.className = "subject-card";
    card.innerHTML =
      '<div class="info"><strong>' + escapeHtml(subject.name) + "</strong><small>" +
      escapeHtml(summary) + '</small></div><span class="secondary go-btn">단원별로 보기</span>';
    card.addEventListener("click", () => openSubject(subject));
    readyList.appendChild(card);
  }

  if (entries.length) renderToday(entries);

  // 신뢰 카드
  $("about-text").textContent = state.config.about || "";
  $("about-short").textContent = state.config.aboutShort || "";
  $("about-meta").textContent = questionCount
    ? "AI 교차 검증을 통과한 연습 문제 " + questionCount + "개"
    : "";
  $("about-disclaimer").textContent = state.config.disclaimer || "";
  const officialUrl = state.config.officialPastExamsUrl;
  $("official-link").innerHTML = officialUrl
    ? '실제 기출문제는 <a href="' + escapeHtml(officialUrl) + '" target="_blank" rel="noopener">공식 게시판</a>에서 볼 수 있어요.'
    : "";
}

// -------------------------------------------------------------
// 2. 과목 화면: 오늘 복습 + 흐름 문제 + 단원 선택 + 약점 지도
// -------------------------------------------------------------
async function openSubject(subject) {
  state.subject = subject;
  let questions;
  try {
    questions = await loadQuestions(subject);
  } catch (e) {
    return;
  }
  const st = computeStats(subject, questions);

  $("subject-title").textContent = subject.name;
  $("ov-seen").textContent = st.seenTotal + "/" + st.total;
  $("ov-rate").textContent = st.seenTotal ? st.rate + "%" : "-";
  const wrongCount = getWrongIds(subject.id).length;
  $("ov-wrong").textContent = wrongCount + "개";

  // 오늘 복습 카드 (있을 때만)
  const due = dueIds(subject.id).length;
  const reviewBox = $("subject-review");
  reviewBox.innerHTML = "";
  if (due > 0) {
    const card = document.createElement("button");
    card.className = "review-card";
    card.innerHTML = reviewCardHtml(subject.name, due);
    card.addEventListener("click", () => startQuiz("review"));
    reviewBox.appendChild(card);
  }

  // 약점 안내 문장. 상황에 따라 세 가지로 말해요.
  const weakBox = $("weak-box");
  weakBox.classList.toggle("has-weak", Boolean(st.weak));
  weakBox.hidden = st.seenTotal === 0;
  if (st.weak) {
    weakBox.innerHTML =
      "지금 가장 약한 단원은 <strong>" + escapeHtml(st.weak.name) + "</strong>이에요. " +
      "정답률 " + st.weak.rate + "%. 이 단원부터 다시 풀어보세요.";
  } else if (st.seenTotal === 0) {
    weakBox.textContent = "";
  } else {
    weakBox.textContent =
      "단원마다 " + MIN_SEEN_FOR_WEAK + "문제 이상 풀면 약점 단원을 찾아드려요. 정답률 80% 미만인 단원이 없다면 잘하고 있는 거예요!";
  }

  // 흐름 문제 카드: 이 사이트만의 특징이라 단원 목록보다 위에 따로 보여줘요.
  const flowBtn = $("flow-card");
  flowBtn.hidden = st.flowCount === 0;
  $("flow-count").textContent = "흐름 문제 " + st.flowCount + "개";

  // 단원 카드: 카드 전체가 버튼. 정답률 막대 색으로 한눈에 상태를 보여줘요.
  const list = $("unit-list");
  list.innerHTML = "";
  st.units.forEach((u) => {
    const level = u.seen === 0 ? "" : u.rate < 60 ? "low" : u.rate < 80 ? "mid" : "high";
    const card = document.createElement("button");
    card.className = "unit-card" + (st.weak && st.weak.name === u.name ? " weak" : "");
    card.innerHTML =
      '<div class="unit-head"><span class="unit-name">' + escapeHtml(u.name) + "</span>" +
      '<span class="unit-rate">' + (u.seen ? u.rate + "%" : "시작 전") + "</span></div>" +
      '<p class="unit-range">' + escapeHtml(u.range || "") + "</p>" +
      '<div class="unit-bar"><div class="' + level + '" style="width:' + (u.seen ? Math.max(u.rate, 4) : 0) + '%"></div></div>' +
      '<div class="unit-foot"><span>' + u.seen + "/" + u.total + '문제 풀이</span><span class="go">풀기 ›</span></div>';
    card.addEventListener("click", () => startQuiz("unit", u.name));
    list.appendChild(card);
  });

  // 오답노트 버튼: 틀린 문제가 없으면 잠가요. 눌러도 아무 일 없는 버튼은 헷갈리니까요.
  const wrongBtn = $("subject-wrong-btn");
  wrongBtn.disabled = wrongCount === 0;
  wrongBtn.textContent = wrongCount ? "오답노트 " + wrongCount : "오답 없음";

  showScreen("subject");
}

// -------------------------------------------------------------
// 퀴즈 시작
// -------------------------------------------------------------
async function startQuiz(mode, unit) {
  if (mode === "today") return startToday();
  if (mode === "again") return startRound("again", null, shuffle(state.lastWrong || []), QUESTIONS_PER_ROUND);
  const subject = state.subject;
  let all;
  try {
    all = await loadQuestions(subject);
  } catch (e) {
    return;
  }

  const seen = getSeen(subject.id);
  // 안 푼 문제를 먼저 내요. 같은 문제만 반복되지 않게요.
  const freshFirst = (qs) =>
    shuffle(qs.filter((q) => !(q.id in seen))).concat(shuffle(qs.filter((q) => q.id in seen)));

  let pool;
  let limit = QUESTIONS_PER_ROUND;
  if (mode === "unit") {
    pool = freshFirst(all.filter((q) => q.unit === unit));
  } else if (mode === "flow") {
    pool = freshFirst(all.filter(isOrder));
  } else if (mode === "wrong") {
    const wrongIds = getWrongIds(subject.id);
    pool = shuffle(all.filter((q) => wrongIds.includes(q.id)));
  } else if (mode === "review") {
    const ids = dueIds(subject.id);
    pool = shuffle(all.filter((q) => ids.includes(q.id)));
    limit = REVIEW_PER_ROUND;
  } else {
    pool = freshFirst(all);
  }
  if (pool.length === 0) {
    openSubject(subject);
    return;
  }

  startRound(mode, unit, pool.map((q) => tagQuestion(q, subject)), limit);
}

// 문제에 '어느 과목 문제인지' 표시를 붙여요(원본은 건드리지 않고 복사본에).
// 오늘의 학습처럼 여러 과목이 한 판에 섞이면, 기록을 어느 과목 칸에 저장할지 알아야 하거든요.
function tagQuestion(q, subject) {
  return Object.assign({}, q, { _sid: subject.id, _sname: subject.name });
}

function startRound(mode, unit, pool, limit) {
  if (!pool.length) return renderHome();
  state.mode = mode;
  state.unit = unit || null;
  state.questions = pool.slice(0, limit);
  state.index = 0;
  state.correctCount = 0;
  state.roundWrong = [];
  renderQuestion();
  showScreen("quiz");
}

// 오늘의 학습: 계획표 순서 그대로 문제를 모아요.
//   복습(모든 과목) → 과목별·단원별 새 문제 → 모자라면 고른 과목의 다른 새 문제
// 한 판은 10문제까지. 목표가 20이면 두 판으로 나눠 풀어요(한 번에 너무 길면 지쳐요).
async function startToday() {
  const plan = state.todayPlan;
  if (!plan) return renderHome();
  const pool = [];
  const used = new Set();
  const add = (q, subject) => {
    const key = subject.id + ":" + q.id;
    if (used.has(key)) return;
    used.add(key);
    pool.push(tagQuestion(q, subject));
  };
  try {
    for (const p of plan.reviewParts) {
      const ids = dueIds(p.subject.id);
      const qs = await loadQuestions(p.subject);
      shuffle(qs.filter((q) => ids.includes(q.id))).slice(0, p.count).forEach((q) => add(q, p.subject));
    }
    for (const p of plan.newParts) {
      const seen = getSeen(p.subject.id);
      const qs = await loadQuestions(p.subject);
      shuffle(qs.filter((q) => q.unit === p.unit.name && !(q.id in seen))).slice(0, p.count).forEach((q) => add(q, p.subject));
    }
    if (!pool.length) {
      for (const s of getMySubjects()) {
        const seen = getSeen(s.id);
        (await loadQuestions(s)).filter((q) => !(q.id in seen)).forEach((q) => add(q, s));
      }
    }
  } catch (e) {
    return renderHome();
  }
  const remaining = Math.max(getGoal() - getDoneToday(), 1);
  startRound("today", null, pool, Math.min(QUESTIONS_PER_ROUND, remaining));
}

// -------------------------------------------------------------
// 3. 문제 하나 그리기
// -------------------------------------------------------------
function renderQuestion() {
  const q = state.questions[state.index];
  const total = state.questions.length;
  state.answered = false;
  state.picked = [];

  $("quiz-progress").textContent = state.index + 1 + "/" + total;
  // 진행 바: '얼마나 남았는지' 보이면 끝까지 풀 확률이 올라가요.
  $("progress-bar").style.width = (state.index / total) * 100 + "%";
  const label = MODE_LABEL[state.mode];
  const subjectTag = state.mode === "today" || state.mode === "again" ? q._sname + " · " : "";
  $("quiz-unit").textContent = (label && state.mode !== "all" ? label + " · " : "") + subjectTag + q.unit;
  $("quiz-question").textContent = q.question;
  $("quiz-feedback").hidden = true;

  // 오류 제보 링크: 주소 안의 {subject}, {id} 자리에 과목과 문제 번호를 끼워 넣어요.
  // 구글폼 '미리 채워진 링크'와 함께 쓰면 두 칸이 자동으로 채워져요.
  const reportUrl = state.config.reportUrl;
  const report = $("report-link");
  report.hidden = !reportUrl;
  if (reportUrl) {
    report.href = reportUrl
      .replace("{subject}", encodeURIComponent(q._sname))
      .replace("{id}", encodeURIComponent(q.id));
  }
  // 문제 번호 표시: 제보할 때 이 번호를 보고 적으면 돼요.
  $("report-id").textContent = q._sname + " · 문제 번호 " + q.id;

  const nextBtn = $("next-btn");
  nextBtn.disabled = true;

  if (isOrder(q)) renderOrder(q);
  else renderChoice(q);
}

// 4지선다 그리기
function renderChoice(q) {
  $("order-box").hidden = true;
  $("quiz-choices").hidden = false;
  // 답을 고르기 전에는 '다음' 버튼을 회색으로 잠가요.
  // 버튼이 사라졌다 나타나면 손가락 위치가 흔들리니까, 자리는 그대로 두고 상태만 바꿔요.
  $("next-btn").textContent = "정답을 골라주세요";

  // 보기 섞기: 보기마다 "원래 몇 번이었는지"를 같이 들고 다녀야
  // 섞은 뒤에도 정답을 알아볼 수 있어요.
  const choices = shuffle(q.choices.map((text, originalIndex) => ({ text, originalIndex })));

  const box = $("quiz-choices");
  box.innerHTML = "";
  choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.innerHTML = '<span class="num">' + (i + 1) + "</span><span>" + escapeHtml(choice.text) + "</span>";
    btn.dataset.correct = String(choice.originalIndex === q.answer);
    btn.addEventListener("click", () => answerChoice(btn, q));
    box.appendChild(btn);
  });
}

// 흐름 문제 그리기: 위에는 순서 칸 4개, 아래에는 섞인 사건 버튼 4개.
// 끌어서 옮기기(드래그)보다 '눌러서 차례대로 고르기'가 폰에서 훨씬 쉽고 실수가 적어요.
function renderOrder(q) {
  $("quiz-choices").hidden = true;
  $("order-box").hidden = false;
  $("next-btn").textContent = "순서대로 눌러주세요";

  const pool = $("order-pool");
  pool.hidden = false;
  $("order-hint").hidden = false;
  pool.innerHTML = "";
  // 사건 버튼에는 숫자 대신 '가나다라'를 붙여요. 위 순서 칸의 1~4와 헷갈리지 않게요.
  const LETTERS = ["가", "나", "다", "라"];
  shuffleNotSorted(q.items).forEach((item, i) => {
    const btn = document.createElement("button");
    btn.className = "choice order-item";
    btn.dataset.item = item;
    btn.innerHTML = '<span class="num letter">' + LETTERS[i] + "</span><span>" + escapeHtml(item) + "</span>";
    btn.addEventListener("click", () => pickOrder(item));
    pool.appendChild(btn);
  });
  drawOrderSlots(q);
}

// 순서 칸 다시 그리기. 칸을 누르면 그 사건을 빼요(잘못 눌렀을 때 고칠 수 있게).
function drawOrderSlots(q) {
  const slots = $("order-slots");
  slots.innerHTML = "";
  for (let i = 0; i < q.items.length; i++) {
    const item = state.picked[i];
    const slot = document.createElement("button");
    slot.className = "order-slot" + (item ? " filled" : "");
    slot.disabled = !item || state.answered;
    slot.dataset.pos = String(i);
    slot.innerHTML =
      '<span class="slot-num">' + (i + 1) + "</span>" +
      (item ? "<span>" + escapeHtml(item) + "</span>" : '<span class="slot-empty">' + (i === state.picked.length ? "여기에 들어가요" : "") + "</span>");
    if (item) slot.addEventListener("click", () => unpickOrder(i));
    slots.appendChild(slot);
  }

  // 이미 고른 사건 버튼은 흐리게 잠가요.
  document.querySelectorAll(".order-item").forEach((btn) => {
    btn.disabled = state.answered || state.picked.includes(btn.dataset.item);
    btn.classList.toggle("used", state.picked.includes(btn.dataset.item));
  });

  if (!state.answered) {
    const full = state.picked.length === q.items.length;
    $("next-btn").disabled = !full;
    $("next-btn").textContent = full ? "정답 확인" : "순서대로 눌러주세요";
  }
}

function pickOrder(item) {
  const q = state.questions[state.index];
  if (state.answered || state.picked.includes(item)) return;
  state.picked.push(item);
  drawOrderSlots(q);
}

function unpickOrder(pos) {
  const q = state.questions[state.index];
  if (state.answered) return;
  state.picked.splice(pos, 1);
  drawOrderSlots(q);
}

// -------------------------------------------------------------
// 채점 결과 기록 (두 문제 종류가 함께 써요)
// -------------------------------------------------------------
function recordResult(q, isCorrect) {
  const subjectId = q._sid;

  // 오늘 푼 문제 수 +1 (오늘의 학습 목표용)
  save("done:" + todayKey(), getDoneToday() + 1);

  // 풀이 기록 (약점 지도용)
  const seen = getSeen(subjectId);
  seen[q.id] = isCorrect ? 1 : 0;
  setSeen(subjectId, seen);

  // 오답노트: 틀리면 넣고, 어느 모드에서든 맞히면 빼요.
  let wrongIds = getWrongIds(subjectId);
  if (isCorrect) {
    state.correctCount++;
    wrongIds = wrongIds.filter((id) => id !== q.id);
  } else {
    state.roundWrong.push(q);
    if (!wrongIds.includes(q.id)) wrongIds.push(q.id);
  }
  setWrongIds(subjectId, wrongIds);

  // 복습 일정
  // - 틀리면: 처음부터 다시, 내일 복습
  // - 복습할 날에 맞히면: 다음 간격으로(1일 → 3일 → 7일), 세 번 다 맞히면 졸업
  // - 아직 복습할 날이 아닌데 맞힌 건 그대로 둬요. 너무 빨리 다시 본 건 기억력 확인이 아니니까요.
  const review = getReview(subjectId);
  if (!isCorrect) {
    review[q.id] = { step: 0, due: addDays(REVIEW_GAPS[0]) };
  } else if (review[q.id] && review[q.id].due <= todayKey()) {
    const step = review[q.id].step + 1;
    if (step >= REVIEW_GAPS.length) delete review[q.id];
    else review[q.id] = { step, due: addDays(REVIEW_GAPS[step]) };
  }
  setReview(subjectId, review);
}

// 해설 보여주기 + 다음 버튼 열기 (두 문제 종류 공통)
function showFeedback(q, isCorrect, extra) {
  const title = $("feedback-title");
  title.textContent = isCorrect ? "정답이에요" : "아쉬워요";
  title.className = "feedback-title " + (isCorrect ? "good" : "bad");
  $("feedback-text").textContent = (extra ? extra + " " : "") + q.explanation;
  $("quiz-feedback").hidden = false;

  const last = state.index === state.questions.length - 1;
  const nextBtn = $("next-btn");
  nextBtn.disabled = false;
  nextBtn.textContent = last ? "결과 보기" : "다음 문제";

  // 해설이 화면 아래로 밀려 안 보일 수 있으니 부드럽게 보여줘요.
  $("quiz-feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// 4지선다: 보기를 눌렀을 때
function answerChoice(clicked, q) {
  if (state.answered) return; // 두 번 눌러도 한 번만 처리
  state.answered = true;
  const isCorrect = clicked.dataset.correct === "true";

  // 정답은 초록, 고른 오답은 빨강, 나머지는 흐리게.
  document.querySelectorAll("#quiz-choices .choice").forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.correct === "true") btn.classList.add("correct");
    else if (btn !== clicked) btn.classList.add("dim");
  });
  if (!isCorrect) clicked.classList.add("wrong");

  recordResult(q, isCorrect);
  showFeedback(q, isCorrect);
}

// 흐름 문제: '정답 확인'을 눌렀을 때
function checkOrder() {
  const q = state.questions[state.index];
  state.answered = true;
  const isCorrect = state.picked.every((item, i) => item === q.items[i]);

  // 칸마다 맞은 자리면 초록, 틀린 자리면 빨강
  drawOrderSlots(q);
  document.querySelectorAll(".order-slot").forEach((slot, i) => {
    slot.classList.add(state.picked[i] === q.items[i] ? "correct" : "wrong");
  });

  // 확인 뒤에는 사건 버튼이 더 필요 없어요. 숨겨야 해설이 바로 아래에 붙어서 폰에서도 보여요.
  $("order-pool").hidden = true;
  $("order-hint").hidden = true;

  recordResult(q, isCorrect);
  showFeedback(q, isCorrect, isCorrect ? "" : "정답 순서:");
}

function next() {
  const q = state.questions[state.index];
  if (!state.answered) {
    // 흐름 문제에서 4칸을 다 채우고 누르면 '정답 확인'
    if (isOrder(q) && state.picked.length === q.items.length) checkOrder();
    return;
  }
  if (state.index < state.questions.length - 1) {
    state.index++;
    renderQuestion();
    window.scrollTo(0, 0);
  } else {
    renderResult();
  }
}

// -------------------------------------------------------------
// 4. 결과 화면
// -------------------------------------------------------------
function renderResult() {
  const total = state.questions.length;
  const score = state.correctCount;

  const label = state.mode === "unit" ? state.unit : MODE_LABEL[state.mode];
  // 여러 과목이 섞인 판이면 과목 이름 대신 '오늘의 학습'만 보여줘요.
  const mixed = state.mode === "today" || state.mode === "again";
  $("result-subject").textContent = mixed ? label : state.subject.name + " · " + label;
  $("result-score").innerHTML = score + "<small> / " + total + "</small>";

  const rate = score / total;
  $("result-message").textContent =
    state.mode === "review" && rate === 1 ? "오늘 복습 끝! 다음 복습 날짜에 다시 알려드릴게요." :
    rate === 1 ? "전부 맞혔어요! 이 범위는 자신 있어도 돼요." :
    rate >= 0.6 ? "좋아요. 틀린 문제는 내일 복습 목록에 자동으로 올라가요." :
    "괜찮아요. 틀린 문제는 내일 복습 목록에 자동으로 올라가요.";

  // 틀린 문제 목록: 처음엔 3개만 보여주고, 나머지는 '모두 보기'로 펼쳐요.
  // 길게 늘어지면 아래 버튼과 응원 칸이 묻히고, 다 보고 싶은 사람은 한 번만 누르면 되니까요.
  state.lastWrong = state.roundWrong.slice();
  state.wrongOpen = false;
  drawResultWrong();
  $("result-back-btn").textContent = mixed ? "홈으로" : "단원 보기";

  // 오늘 목표 진행: 한 판이 끝날 때마다 "오늘 얼마나 왔는지" 보여줘요.
  const goal = getGoal();
  const done = getDoneToday();
  const left = Math.max(goal - done, 0);
  $("result-today").textContent =
    "오늘의 학습 " + Math.min(done, goal) + "/" + goal + (left ? " · " + left + "문제 남았어요" : " · 목표 달성!");

  // 가장 권하고 싶은 행동을 오른쪽 큰 파란 버튼에.
  const retry = $("retry-btn");
  if (state.mode === "today" && left > 0) {
    // 오늘의 학습 중이면 '이어서'가 가장 자연스러운 다음 행동이에요.
    // 틀린 문제는 내일 복습에 자동으로 올라가니 따로 챙기지 않아도 돼요.
    retry.textContent = "이어서 " + Math.min(left, QUESTIONS_PER_ROUND) + "문제 더";
    retry.onclick = () => startQuiz("today");
  } else if (state.roundWrong.length > 0) {
    // 방금 틀린 문제만 바로 다시. (오늘의 학습처럼 과목이 섞여 있어도 돼요)
    retry.textContent = "틀린 문제 다시 풀기";
    retry.onclick = () => startQuiz("again");
  } else if (mixed) {
    retry.textContent = "홈에서 계속";
    retry.onclick = renderHome;
  } else if (state.mode === "review" || state.mode === "wrong") {
    retry.textContent = "새 문제 풀기";
    retry.onclick = () => startQuiz("all");
  } else {
    retry.textContent = "한 판 더";
    retry.onclick = () => startQuiz(state.mode, state.unit);
  }

  // 후원 안내는 결과 화면에서만: 도움을 받은 "뒤"에 부탁해야 거부감이 적어요.
  renderSupport();

  $("progress-bar").style.width = "100%";
  showScreen("result");
}

const WRONG_PREVIEW = 3;
function drawResultWrong() {
  const list = state.roundWrong;
  const shown = state.wrongOpen ? list : list.slice(0, WRONG_PREVIEW);
  const mixed = new Set(list.map((q) => q._sid)).size > 1;
  $("result-wrong-list").innerHTML = shown
    .map((q) =>
      "<li>" + (mixed ? '<span class="tag">' + escapeHtml(q._sname) + "</span>" : "") +
      escapeHtml(isOrder(q) ? "[흐름] " + q.items.slice().sort().join(", ") : q.question) +
      "<span>정답: " + escapeHtml(answerText(q)) + "</span></li>")
    .join("");
  $("result-wrong").hidden = list.length === 0;
  const more = $("result-wrong-more");
  more.hidden = list.length <= WRONG_PREVIEW;
  more.textContent = state.wrongOpen ? "접기" : "틀린 문제 모두 보기 (" + list.length + ")";
}

// -------------------------------------------------------------
// 응원(후원) 칸
// -------------------------------------------------------------
function renderSupport() {
  const donateUrl = state.config.donateUrl;
  const intent = state.config.supportMode === "intent";
  $("donate-box").hidden = !donateUrl && !intent;
  $("donate-link").hidden = !donateUrl;
  if (donateUrl) $("donate-link").href = donateUrl;

  // 수요 검증 모드: 오늘 이미 눌렀다면 고맙다는 문장을 바로 보여줘요.
  const clickedToday = load("supportClicked", "") === todayKey();
  $("support-btn").hidden = Boolean(donateUrl) || !intent || clickedToday;
  $("support-thanks").hidden = Boolean(donateUrl) || !clickedToday;
}

function onSupportClick() {
  $("support-btn").hidden = true;
  $("support-thanks").hidden = false;

  // 같은 사람이 여러 번 눌러도 하루에 한 번만 세요. 그래야 '사람 수'에 가까운 숫자가 나와요.
  if (load("supportClicked", "") === todayKey()) return;
  save("supportClicked", todayKey());
  logEvent("support_click");
}

// 익명 이벤트 기록: 구글폼에 '이벤트 이름' 한 칸만 보내요. 누가 눌렀는지는 보내지 않아요.
// config의 eventLogUrl에는 구글폼 '미리 채워진 링크'를 넣고, 값 자리를 {event}로 바꿔두면 돼요.
// mode: "no-cors"는 '응답은 안 읽어도 되니 보내기만 해줘'라는 뜻이에요.
// 다른 사이트(구글)로 보내는 요청이라 응답을 읽으려 하면 브라우저가 막는데, 우리는 보내기만 하면 되거든요.
function logEvent(name) {
  const tpl = state.config.eventLogUrl;
  if (!tpl) return;
  try {
    const url = new URL(tpl.replace("{event}", encodeURIComponent(name)).replace("/viewform", "/formResponse"));
    const body = new URLSearchParams(url.searchParams);
    body.delete("usp");
    fetch(url.origin + url.pathname, { method: "POST", mode: "no-cors", body });
  } catch (e) {
    /* 기록이 실패해도 사용자 화면에는 영향이 없어야 해요 */
  }
}

// -------------------------------------------------------------
// 키보드: 컴퓨터로 푸는 사람은 1~4로 고르고 Enter로 넘어가요.
// -------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if ($("screen-quiz").hidden) return;
  const q = state.questions[state.index];
  if (["1", "2", "3", "4"].includes(e.key) && !state.answered) {
    const selector = isOrder(q) ? ".order-item" : "#quiz-choices .choice";
    const btn = document.querySelectorAll(selector)[Number(e.key) - 1];
    if (btn && !btn.disabled) btn.click();
  } else if (e.key === "Backspace" && isOrder(q) && !state.answered && state.picked.length) {
    unpickOrder(state.picked.length - 1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    next();
  }
});

// -------------------------------------------------------------
// 방문자 통계 (Cloudflare Web Analytics)
// config.json에 토큰이 있을 때만 켜요. 쿠키를 쓰지 않고 개인을 추적하지 않는 방식이에요.
// -------------------------------------------------------------
function startAnalytics() {
  const token = state.config.analyticsToken;
  if (!token) return;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token }));
  document.head.appendChild(s);
}

// -------------------------------------------------------------
// 시작
// -------------------------------------------------------------
async function init() {
  try {
    const res = await fetch(withVersion("data/config.json"));
    if (!res.ok) throw new Error("config.json 없음");
    state.config = await res.json();
    // 오늘의 한마디 목록. 못 불러와도 사이트는 동작해야 하니 실패는 조용히 넘어가요.
    try {
      const qr = await fetch(withVersion("data/quotes.json"));
      state.quotes = qr.ok ? await qr.json() : [];
    } catch (e) {
      state.quotes = [];
    }
  } catch (e) {
    $("ready-list").textContent = "설정을 불러오지 못했어요. 새로고침해 주세요.";
    showError();
    return;
  }

  document.title = state.config.siteName;
  $("site-name").textContent = state.config.siteName;

  // 버튼 연결. 요소가 없을 때 바로 멈추지 않도록 on() 도우미를 써요.
  // (예전에 빈 화면이 된 건 없는 버튼에 연결하려다 코드 전체가 멈춘 것이었어요.)
  const on = (id, event, fn) => {
    const el = $(id);
    if (el) el.addEventListener(event, fn);
    else console.warn("화면에 없는 요소:", id);
  };
  on("next-btn", "click", next);
  const backFromRound = () => (state.mode === "today" || state.mode === "again" ? renderHome() : openSubject(state.subject));
  on("quit-btn", "click", backFromRound);
  on("result-home-btn", "click", renderHome);
  on("result-wrong-more", "click", () => {
    state.wrongOpen = !state.wrongOpen;
    drawResultWrong();
  });
  on("subject-back-btn", "click", renderHome);
  // 오늘의 학습에서 온 경우엔 홈(오늘 카드)으로, 아니면 과목 화면으로 돌아가요.
  on("result-back-btn", "click", backFromRound);
  on("subject-all-btn", "click", () => startQuiz("all"));
  on("subject-wrong-btn", "click", () => startQuiz("wrong"));
  on("flow-card", "click", () => startQuiz("flow"));
  on("support-btn", "click", onSupportClick);

  // 일부 컴퓨터 브라우저는 숨긴 날짜칸을 눌러도 달력이 안 열려요.
  // 그래서 직접 달력을 열어달라고 요청해요(지원하는 브라우저에서만).
  on("exam-date-input", "click", (e) => {
    try { e.target.showPicker(); } catch (err) { /* 미지원이면 기본 동작 */ }
  });
  on("exam-date-input", "change", (e) => {
    save("examDate", e.target.value);
    renderDday();
  });

  startAnalytics();
  renderHome();
}

init();
