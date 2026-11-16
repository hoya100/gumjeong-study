// =============================================================
// 검정고시 기출유형 퀴즈 - 동작 코드
// 흐름: 설정 불러오기 → 홈(과목) → 과목(단원·약점) → 퀴즈 → 결과
// =============================================================

// 한 번 퀴즈를 시작했을 때 풀 문제 수.
// 너무 많으면 지쳐서 중간에 나가요. 10문제면 5분 안쪽이라 부담이 적어요.
const QUESTIONS_PER_ROUND = 10;

// 약점이라고 판단하려면 그 단원에서 최소 몇 문제는 풀어봐야 해요.
// 1~2문제로 "약점"이라고 하면 우연히 틀린 걸 약점으로 오해하게 돼요.
const MIN_SEEN_FOR_WEAK = 3;

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
  mode: "all",       // "all" = 전체, "unit" = 단원, "wrong" = 오답노트
  unit: null,        // 단원 모드일 때 고른 단원 이름
};

// -------------------------------------------------------------
// 브라우저 저장소(localStorage) 도우미
// 서버 없이 사용자 기기 안에 오답노트, 풀이 기록, 시험일을 저장해요.
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

const percent = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100));

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
    const res = await fetch(subject.file);
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

  // 풀 수 있는 과목: 카드 전체가 버튼이에요. 어디를 눌러도 과목 화면으로 가요.
  // (작은 버튼만 누를 수 있으면 손가락이 빗나가기 쉬워요.)
  const readyList = $("ready-list");
  readyList.innerHTML = "";
  let questionCount = 0;
  for (const subject of ready) {
    let summary = "";
    try {
      const qs = await loadQuestions(subject);
      questionCount += qs.length;
      const st = computeStats(subject, qs);
      summary = st.seenTotal
        ? st.total + "문제 중 " + st.seenTotal + "문제 풀이 · 정답률 " + st.rate + "%"
        : st.total + "문제 · 단원별로 풀 수 있어요";
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
// 2. 과목 화면: 단원 선택 + 약점 지도
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
// mode: "all"(전체 범위) | "unit"(단원) | "wrong"(오답노트)
// -------------------------------------------------------------
async function startQuiz(mode, unit) {
  const subject = state.subject;
  let all;
  try {
    all = await loadQuestions(subject);
  } catch (e) {
    return;
  }

  let pool = all;
  if (mode === "unit") {
    pool = all.filter((q) => q.unit === unit);
    // 단원 안에서는 안 푼 문제를 먼저 내요. 같은 문제만 반복되지 않게요.
    const seen = getSeen(subject.id);
    const fresh = shuffle(pool.filter((q) => !(q.id in seen)));
    const old = shuffle(pool.filter((q) => q.id in seen));
    pool = fresh.concat(old);
  } else if (mode === "wrong") {
    const wrongIds = getWrongIds(subject.id);
    pool = shuffle(all.filter((q) => wrongIds.includes(q.id)));
  } else {
    pool = shuffle(all);
  }
  if (pool.length === 0) {
    openSubject(subject);
    return;
  }

  state.mode = mode;
  state.unit = unit || null;
  state.questions = pool.slice(0, QUESTIONS_PER_ROUND);
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

  $("quiz-progress").textContent = state.index + 1 + "/" + total;
  // 진행 바: '얼마나 남았는지' 보이면 끝까지 풀 확률이 올라가요.
  $("progress-bar").style.width = (state.index / total) * 100 + "%";
  $("quiz-unit").textContent = (state.mode === "wrong" ? "오답노트 · " : "") + q.unit;
  $("quiz-question").textContent = q.question;
  $("quiz-feedback").hidden = true;

  // 답을 고르기 전에는 '다음' 버튼을 회색으로 잠가요.
  // 버튼이 사라졌다 나타나면 손가락 위치가 흔들리니까, 자리는 그대로 두고 상태만 바꿔요.
  const nextBtn = $("next-btn");
  nextBtn.disabled = true;
  nextBtn.textContent = "정답을 골라주세요";

  // 주소 안의 {id} 자리에 지금 문제 번호를 끼워 넣어요.
  // 구글폼의 '미리 채워진 링크'와 함께 쓰면 문제 번호 칸이 자동으로 채워져요.
  const reportUrl = state.config.reportUrl;
  const report = $("report-link");
  report.hidden = !reportUrl;
  if (reportUrl) report.href = reportUrl.replace("{id}", encodeURIComponent(q.id));

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
    btn.addEventListener("click", () => answer(btn, q));
    box.appendChild(btn);
  });
}

// -------------------------------------------------------------
// 보기를 눌렀을 때
// -------------------------------------------------------------
function answer(clicked, q) {
  if (state.answered) return; // 두 번 눌러도 한 번만 처리
  state.answered = true;
  const isCorrect = clicked.dataset.correct === "true";
  const subjectId = state.subject.id;

  // 정답은 초록, 고른 오답은 빨강, 나머지는 흐리게.
  document.querySelectorAll(".choice").forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.correct === "true") btn.classList.add("correct");
    else if (btn !== clicked) btn.classList.add("dim");
  });
  if (!isCorrect) clicked.classList.add("wrong");

  // 풀이 기록 저장 (약점 지도용)
  const seen = getSeen(subjectId);
  seen[q.id] = isCorrect ? 1 : 0;
  setSeen(subjectId, seen);

  // 오답노트 갱신
  // - 틀리면 추가 (이미 있으면 그대로)
  // - 어느 모드에서든 맞히면 빼기: 이제 아는 문제니까요
  let wrongIds = getWrongIds(subjectId);
  if (isCorrect) {
    state.correctCount++;
    wrongIds = wrongIds.filter((id) => id !== q.id);
  } else {
    state.roundWrong.push(q);
    if (!wrongIds.includes(q.id)) wrongIds.push(q.id);
  }
  setWrongIds(subjectId, wrongIds);

  // 해설: 틀렸을 때 "왜"를 바로 알려주는 게 학습 효과가 제일 커요.
  const title = $("feedback-title");
  title.textContent = isCorrect ? "정답이에요" : "아쉬워요";
  title.className = "feedback-title " + (isCorrect ? "good" : "bad");
  $("feedback-text").textContent = q.explanation;
  $("quiz-feedback").hidden = false;

  const last = state.index === state.questions.length - 1;
  const nextBtn = $("next-btn");
  nextBtn.disabled = false;
  nextBtn.textContent = last ? "결과 보기" : "다음 문제";

  // 해설이 화면 아래로 밀려 안 보일 수 있으니 부드럽게 보여줘요.
  $("quiz-feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function next() {
  if (!state.answered) return;
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

  const label =
    state.mode === "wrong" ? " 오답노트" : state.mode === "unit" ? " · " + state.unit : " 전체 범위";
  $("result-subject").textContent = state.subject.name + label;
  $("result-score").innerHTML = score + "<small> / " + total + "</small>";

  const rate = score / total;
  $("result-message").textContent =
    rate === 1 ? "전부 맞혔어요! 이 범위는 자신 있어도 돼요." :
    rate >= 0.6 ? "좋아요. 틀린 문제만 한 번 더 보면 완벽해요." :
    "괜찮아요. 해설을 읽고 오답노트로 다시 풀어보세요.";

  // 틀린 문제 목록: 무엇을 틀렸는지 한눈에 보여야 다시 풀 마음이 생겨요.
  $("result-wrong-list").innerHTML = state.roundWrong
    .map((q) => "<li>" + escapeHtml(q.question) + "<span>정답: " + escapeHtml(q.choices[q.answer]) + "</span></li>")
    .join("");
  $("result-wrong").hidden = state.roundWrong.length === 0;

  // 가장 권하고 싶은 행동을 오른쪽 큰 파란 버튼에:
  // 이번에 틀린 게 있으면 '오답 다시 풀기', 다 맞았으면 같은 범위로 한 판 더.
  const retry = $("retry-btn");
  if (state.roundWrong.length > 0) {
    retry.textContent = "틀린 문제 다시 풀기";
    retry.onclick = () => startQuiz("wrong");
  } else {
    retry.textContent = "한 판 더";
    retry.onclick = () => startQuiz(state.mode === "wrong" ? "all" : state.mode, state.unit);
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
  if (["1", "2", "3", "4"].includes(e.key) && !state.answered) {
    const btn = document.querySelectorAll(".choice")[Number(e.key) - 1];
    if (btn) btn.click();
  } else if (e.key === "Enter" && state.answered) {
    e.preventDefault();
    next();
  }
});

// -------------------------------------------------------------
// 시작
// -------------------------------------------------------------
async function init() {
  try {
    const res = await fetch("data/config.json");
    state.config = await res.json();
  } catch (e) {
    $("ready-list").textContent = "설정을 불러오지 못했어요. 새로고침해 주세요.";
    return;
  }

  document.title = state.config.siteName;
  $("site-name").textContent = state.config.siteName;

  $("next-btn").addEventListener("click", next);
  $("quit-btn").addEventListener("click", () => openSubject(state.subject));
  $("subject-back-btn").addEventListener("click", renderHome);
  $("result-back-btn").addEventListener("click", () => openSubject(state.subject));
  $("subject-all-btn").addEventListener("click", () => startQuiz("all"));
  $("subject-wrong-btn").addEventListener("click", () => startQuiz("wrong"));

  // 일부 컴퓨터 브라우저는 숨긴 날짜칸을 눌러도 달력이 안 열려요.
  // 그래서 직접 달력을 열어달라고 요청해요(지원하는 브라우저에서만).
  $("exam-date-input").addEventListener("click", (e) => {
    try { e.target.showPicker(); } catch (err) { /* 미지원이면 기본 동작 */ }
  });
  $("exam-date-input").addEventListener("change", (e) => {
    save("examDate", e.target.value);
    renderDday();
  });

  renderHome();
}

init();
