// =============================================================
// 검정고시 기출유형 퀴즈 - 동작 코드
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

const MODE_LABEL = { all: "전체 범위", unit: "", wrong: "오답노트", review: "오늘의 복습", flow: "흐름 문제", today: "오늘의 학습" };

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
    el.textContent = "시험일을 설정하세요";
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

function makePlan(subject, st) {
  const goal = getGoal();
  const done = getDoneToday();
  const remaining = Math.max(goal - done, 0);
  const due = dueIds(subject.id).length;
  const reviewPart = Math.min(due, remaining);
  const unit = pickUnit(st);
  const newPart = unit ? remaining - reviewPart : 0;
  return { goal, done, remaining, due, reviewPart, newPart, unit };
}

function renderToday(subject, questions, st) {
  const plan = makePlan(subject, st);
  state.todayPlan = { subjectId: subject.id, unit: plan.unit ? plan.unit.name : null };

  $("today-count").textContent = Math.min(plan.done, plan.goal) + " / " + plan.goal;
  const bar = $("today-bar");
  bar.style.width = Math.min(100, percent(plan.done, plan.goal)) + "%";
  bar.classList.toggle("done", plan.remaining === 0);

  // 오늘 할 일 목록
  const items = [];
  if (plan.remaining === 0) {
    items.push('<li class="done-msg">오늘 목표 달성! 더 풀면 내일이 더 가벼워져요.</li>');
  } else {
    if (plan.reviewPart > 0) items.push("<li>복습 " + plan.reviewPart + "문제 · 잊어버리기 전에 다시 보기</li>");
    if (plan.newPart > 0) {
      const why = st.weak && plan.unit.name === st.weak.name ? " (약점 단원)" : "";
      items.push("<li>새 문제 " + plan.newPart + "개 · " + escapeHtml(plan.unit.name) + why + "</li>");
    }
    if (!items.length) items.push("<li>모든 문제를 한 번씩 풀었어요! 전체 범위로 다시 다져보세요.</li>");
  }
  $("today-plan").innerHTML = items.join("");

  const start = $("today-start");
  start.textContent = plan.remaining === 0 ? "한 판 더 풀기" : plan.done === 0 ? "오늘 계획대로 시작" : "이어서 하기";
  start.onclick = () => {
    state.subject = subject;
    startQuiz(plan.remaining === 0 ? "all" : "today");
  };

  // 내일 미리보기: 내일까지 쌓일 복습 + 오늘 단원 다음으로 추천할 단원
  const tomorrowDue = dueIdsBy(subject.id, addDays(1)).length;
  const nextUnit = pickUnit(st, plan.unit ? plan.unit.name : null) || plan.unit;
  const parts = [];
  if (tomorrowDue > 0) parts.push("복습 " + tomorrowDue + "문제");
  if (nextUnit) parts.push(nextUnit.name);
  $("tomorrow-text").textContent = parts.length ? "내일은 " + parts.join(" + ") + " 순서로 추천해요." : "";

  // 목표 고르기 칩
  const chips = $("goal-chips");
  chips.innerHTML = "";
  DAILY_GOALS.forEach((g) => {
    const chip = document.createElement("button");
    chip.className = "goal-chip" + (g === plan.goal ? " on" : "");
    chip.textContent = g;
    chip.setAttribute("aria-label", "하루 " + g + "문제");
    chip.addEventListener("click", () => {
      save("dailyGoal", g);
      renderToday(subject, questions, st);
    });
    chips.appendChild(chip);
  });

  $("today-card").hidden = false;
}

// -------------------------------------------------------------
// 1. 홈 화면
// -------------------------------------------------------------
async function renderHome() {
  const ready = state.config.subjects.filter((s) => s.file);
  const soon = state.config.subjects.filter((s) => !s.file);

  showScreen("home");
  renderDday();

  // 준비 중인 과목: 누를 수 없으니 버튼이 아니라 작은 글자 칩으로.
  $("soon-list").innerHTML = soon
    .map((s) => '<span class="soon-chip">' + escapeHtml(s.name) + "</span>")
    .join("");

  renderQuote();

  // 풀 수 있는 과목: 카드 전체가 버튼이에요. 어디를 눌러도 과목 화면으로 가요.
  const readyList = $("ready-list");
  readyList.innerHTML = "";
  let questionCount = 0;
  let todayDrawn = false;
  for (const subject of ready) {
    let summary = "";
    try {
      const qs = await loadQuestions(subject);
      questionCount += qs.length;
      const st = computeStats(subject, qs);
      summary = st.seenTotal
        ? st.total + "문제 중 " + st.seenTotal + "문제 풀이 · 정답률 " + st.rate + "%"
        : st.total + "문제 · 단원별 · 흐름 문제 " + st.flowCount + "개";

      // 오늘의 학습 카드는 첫 번째 과목 기준으로 그려요. (과목이 늘면 과목별로 나눌 수 있어요)
      if (!todayDrawn) {
        renderToday(subject, qs, st);
        todayDrawn = true;
      }
    } catch (e) {
      summary = "문제를 불러오지 못했어요";
    }

    const card = document.createElement("button");
    card.className = "subject-card";
    card.innerHTML =
      '<div class="info"><strong>' + escapeHtml(subject.name) + "</strong><small>" +
      escapeHtml(summary) + '</small></div><span class="primary go-btn">공부하기</span>';
    card.addEventListener("click", () => openSubject(subject));
    readyList.appendChild(card);
  }

  // 신뢰 카드
  $("about-text").textContent = state.config.about || "";
  $("about-meta").textContent = questionCount
    ? "지금까지 검증을 통과한 문제 " + questionCount + "개 · 기출 유형을 참고해 새로 만든 연습 문제예요."
    : "";
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
  if (st.weak) {
    weakBox.innerHTML =
      "지금 가장 약한 단원은 <strong>" + escapeHtml(st.weak.name) + "</strong>이에요. " +
      "정답률 " + st.weak.rate + "%. 이 단원부터 다시 풀어보세요.";
  } else if (st.seenTotal === 0) {
    weakBox.textContent = "단원을 골라 풀기 시작하면, 어느 단원이 약한지 여기서 알려드려요.";
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
  } else if (mode === "today") {
    // 오늘의 학습: 복습할 문제 먼저 → 추천 단원의 새 문제 → 그래도 모자라면 다른 단원의 새 문제.
    // 한 판은 10문제까지. 목표가 20이면 두 판으로 나눠서 풀어요(한 번에 너무 길면 지쳐요).
    const ids = dueIds(subject.id);
    const review = shuffle(all.filter((q) => ids.includes(q.id)));
    const picked = new Set(review.map((q) => q.id));
    const rec = state.todayPlan && state.todayPlan.unit;
    const fresh = freshFirst(all.filter((q) => !picked.has(q.id) && !(q.id in seen)));
    const recFirst = fresh.filter((q) => q.unit === rec).concat(fresh.filter((q) => q.unit !== rec));
    pool = review.concat(recFirst);
    const remaining = Math.max(getGoal() - getDoneToday(), 1);
    limit = Math.min(QUESTIONS_PER_ROUND, remaining);
    if (pool.length === 0) pool = freshFirst(all); // 다 풀었으면 전체에서
  } else {
    pool = freshFirst(all);
  }
  if (pool.length === 0) {
    openSubject(subject);
    return;
  }

  state.mode = mode;
  state.unit = unit || null;
  state.questions = pool.slice(0, limit);
  state.index = 0;
  state.correctCount = 0;
  state.roundWrong = [];

  renderQuestion();
  showScreen("quiz");
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
  $("quiz-unit").textContent = (label && state.mode !== "all" ? label + " · " : "") + q.unit;
  $("quiz-question").textContent = q.question;
  $("quiz-feedback").hidden = true;

  // 오류 제보 링크: 주소 안의 {subject}, {id} 자리에 과목과 문제 번호를 끼워 넣어요.
  // 구글폼 '미리 채워진 링크'와 함께 쓰면 두 칸이 자동으로 채워져요.
  const reportUrl = state.config.reportUrl;
  const report = $("report-link");
  report.hidden = !reportUrl;
  if (reportUrl) {
    report.href = reportUrl
      .replace("{subject}", encodeURIComponent(state.subject.name))
      .replace("{id}", encodeURIComponent(q.id));
  }
  // 문제 번호 표시: 제보할 때 이 번호를 보고 적으면 돼요.
  $("report-id").textContent = state.subject.name + " · 문제 번호 " + q.id;

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
  const subjectId = state.subject.id;

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
  $("result-subject").textContent = state.subject.name + " · " + label;
  $("result-score").innerHTML = score + "<small> / " + total + "</small>";

  const rate = score / total;
  $("result-message").textContent =
    state.mode === "review" && rate === 1 ? "오늘 복습 끝! 다음 복습 날짜에 다시 알려드릴게요." :
    rate === 1 ? "전부 맞혔어요! 이 범위는 자신 있어도 돼요." :
    rate >= 0.6 ? "좋아요. 틀린 문제는 내일 복습 목록에 자동으로 올라가요." :
    "괜찮아요. 틀린 문제는 내일 복습 목록에 자동으로 올라가요.";

  // 틀린 문제 목록: 무엇을 틀렸는지 한눈에 보여야 다시 풀 마음이 생겨요.
  $("result-wrong-list").innerHTML = state.roundWrong
    .map((q) =>
      "<li>" + escapeHtml(isOrder(q) ? "[흐름] " + q.items.slice().sort().join(", ") : q.question) +
      "<span>정답: " + escapeHtml(answerText(q)) + "</span></li>")
    .join("");
  $("result-wrong").hidden = state.roundWrong.length === 0;
  $("result-back-btn").textContent = state.mode === "today" ? "홈으로" : "단원 보기";

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
    retry.textContent = "틀린 문제 다시 풀기";
    retry.onclick = () => startQuiz("wrong");
  } else if (state.mode === "review" || state.mode === "wrong") {
    retry.textContent = "새 문제 풀기";
    retry.onclick = () => startQuiz("all");
  } else {
    retry.textContent = "한 판 더";
    retry.onclick = () => startQuiz(state.mode, state.unit);
  }

  // 후원 안내는 결과 화면에서만: 도움을 받은 "뒤"에 부탁해야 거부감이 적어요.
  const donateUrl = state.config.donateUrl;
  $("donate-box").hidden = !donateUrl;
  if (donateUrl) $("donate-link").href = donateUrl;

  $("progress-bar").style.width = "100%";
  showScreen("result");
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
  on("quit-btn", "click", () => (state.mode === "today" ? renderHome() : openSubject(state.subject)));
  on("subject-back-btn", "click", renderHome);
  // 오늘의 학습에서 온 경우엔 홈(오늘 카드)으로, 아니면 과목 화면으로 돌아가요.
  on("result-back-btn", "click", () => (state.mode === "today" ? renderHome() : openSubject(state.subject)));
  on("subject-all-btn", "click", () => startQuiz("all"));
  on("subject-wrong-btn", "click", () => startQuiz("wrong"));
  on("flow-card", "click", () => startQuiz("flow"));

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
