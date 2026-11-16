// =============================================================
// 검정고시 기출유형 퀴즈 - 동작 코드
// 흐름: 설정 불러오기 → 홈(과목 선택) → 퀴즈 → 결과
// =============================================================

// 한 번 퀴즈를 시작했을 때 풀 문제 수.
// 너무 많으면 지쳐서 중간에 나가요. 10문제면 5분 안쪽이라 부담이 적어요.
const QUESTIONS_PER_ROUND = 10;

// 프로그램이 "지금 어떤 상태인지" 기억하는 곳이에요.
// 화면을 그릴 때 항상 여기 값을 보고 그려요.
const state = {
  config: null,      // config.json 내용 (과목 목록, 링크들)
  subject: null,     // 지금 풀고 있는 과목
  questions: [],     // 이번 판에 풀 문제들
  index: 0,          // 몇 번째 문제를 보고 있는지 (0부터 셈)
  correctCount: 0,   // 맞힌 개수
  roundWrong: [],    // 이번 판에서 틀린 문제들 (결과 화면에 보여줄 용도)
  answered: false,   // 지금 문제에 답을 했는지
  mode: "all",       // "all" = 전체 문제, "wrong" = 틀린 문제만
};

// -------------------------------------------------------------
// 브라우저 저장소(localStorage) 도우미
// 서버 없이 사용자 기기 안에 오답노트와 시험일을 저장해요.
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

const getWrongIds = (subjectId) => load("wrong:" + subjectId, []);
const setWrongIds = (subjectId, ids) => save("wrong:" + subjectId, ids);

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

// 화면 전환: 보여줄 화면 하나만 켜고 나머지는 숨겨요.
function showScreen(name) {
  ["home", "quiz", "result"].forEach((s) => {
    $("screen-" + s).hidden = s !== name;
  });
  window.scrollTo(0, 0);
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
// 홈 화면
// -------------------------------------------------------------
function renderHome() {
  const ready = state.config.subjects.filter((s) => s.file);
  const soon = state.config.subjects.filter((s) => !s.file);

  // 풀 수 있는 과목: 카드마다 [오답노트] [풀기] 버튼.
  // '풀기'를 오른쪽 끝에 두는 이유: 오른손 엄지가 가장 쉽게 닿는 쪽이에요.
  const readyList = $("ready-list");
  readyList.innerHTML = "";
  ready.forEach((subject) => {
    const wrongCount = getWrongIds(subject.id).length;
    const last = load("last:" + subject.id, null);

    const card = document.createElement("div");
    card.className = "subject-card";
    card.innerHTML =
      '<div class="info"><strong>' + escapeHtml(subject.name) + "</strong><small>" +
      (last ? "최근 " + last.total + "문제 중 " + last.score + "개 정답" : "아직 안 풀었어요") +
      (wrongCount ? " · 오답 " + wrongCount + "개" : "") +
      '</small></div><div class="actions"></div>';

    const actions = card.querySelector(".actions");
    if (wrongCount > 0) {
      const wrongBtn = document.createElement("button");
      wrongBtn.className = "secondary";
      wrongBtn.textContent = "오답노트";
      wrongBtn.addEventListener("click", () => startQuiz(subject, "wrong"));
      actions.appendChild(wrongBtn);
    }
    const startBtn = document.createElement("button");
    startBtn.className = "primary";
    startBtn.textContent = "풀기";
    startBtn.addEventListener("click", () => startQuiz(subject, "all"));
    actions.appendChild(startBtn);

    readyList.appendChild(card);
  });

  // 준비 중인 과목: 누를 수 없으니 버튼이 아니라 작은 글자 칩으로.
  // 누를 수 없는 걸 버튼처럼 만들면 사용자가 눌러보고 헷갈려요.
  $("soon-list").innerHTML = soon
    .map((s) => '<span class="soon-chip">' + escapeHtml(s.name) + "</span>")
    .join("");

  const officialUrl = state.config.officialPastExamsUrl;
  $("official-link").innerHTML = officialUrl
    ? '실제 기출문제는 <a href="' + escapeHtml(officialUrl) + '" target="_blank" rel="noopener">공식 게시판</a>에서 볼 수 있어요.'
    : "";

  renderDday();
  showScreen("home");
}

// -------------------------------------------------------------
// 퀴즈 시작
// -------------------------------------------------------------
async function startQuiz(subject, mode) {
  // 문제 파일은 과목을 고른 "그때" 불러와요.
  // 처음부터 모든 과목을 다 불러오면 첫 화면이 느려지거든요.
  let all;
  try {
    const res = await fetch(subject.file);
    all = await res.json();
  } catch (e) {
    $("dday").textContent = "문제를 불러오지 못했어요";
    return;
  }

  let pool = all;
  if (mode === "wrong") {
    const wrongIds = getWrongIds(subject.id);
    pool = all.filter((q) => wrongIds.includes(q.id));
  }
  if (pool.length === 0) {
    renderHome();
    return;
  }

  state.subject = subject;
  state.mode = mode;
  state.questions = shuffle(pool).slice(0, QUESTIONS_PER_ROUND);
  state.index = 0;
  state.correctCount = 0;
  state.roundWrong = [];

  renderQuestion();
  showScreen("quiz");
}

// -------------------------------------------------------------
// 문제 하나 그리기
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

  const reportUrl = state.config.reportUrl;
  const report = $("report-link");
  report.hidden = !reportUrl;
  if (reportUrl) report.href = reportUrl + (reportUrl.includes("?") ? "&" : "?") + "q=" + q.id;

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

  // 정답은 초록, 고른 오답은 빨강, 나머지는 흐리게.
  // 눈이 정답과 내가 고른 것에만 가도록 나머지를 흐리게 해요.
  document.querySelectorAll(".choice").forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.correct === "true") btn.classList.add("correct");
    else if (btn !== clicked) btn.classList.add("dim");
  });
  if (!isCorrect) clicked.classList.add("wrong");

  // 오답노트 갱신
  // - 틀리면 추가 (이미 있으면 그대로)
  // - 오답노트 모드에서 맞히면 빼기: 이제 아는 문제니까요
  let wrongIds = getWrongIds(state.subject.id);
  if (isCorrect) {
    state.correctCount++;
    if (state.mode === "wrong") wrongIds = wrongIds.filter((id) => id !== q.id);
  } else {
    state.roundWrong.push(q);
    if (!wrongIds.includes(q.id)) wrongIds.push(q.id);
  }
  setWrongIds(state.subject.id, wrongIds);

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
// 결과 화면
// -------------------------------------------------------------
function renderResult() {
  const total = state.questions.length;
  const score = state.correctCount;

  if (state.mode === "all") save("last:" + state.subject.id, { score, total });

  $("result-subject").textContent = state.subject.name + (state.mode === "wrong" ? " 오답노트" : "");
  $("result-score").innerHTML = score + "<small> / " + total + "</small>";

  const rate = score / total;
  $("result-message").textContent =
    rate === 1 ? "전부 맞혔어요! 이 범위는 자신 있어도 돼요." :
    rate >= 0.6 ? "좋아요. 틀린 문제만 한 번 더 보면 완벽해요." :
    "괜찮아요. 해설을 읽고 오답노트로 다시 풀어보세요.";

  // 틀린 문제 목록: 무엇을 틀렸는지 한눈에 보여야 다시 풀 마음이 생겨요.
  const list = $("result-wrong-list");
  list.innerHTML = state.roundWrong
    .map((q) => "<li>" + escapeHtml(q.question) + "<span>정답: " + escapeHtml(q.choices[q.answer]) + "</span></li>")
    .join("");
  $("result-wrong").hidden = state.roundWrong.length === 0;

  // 가장 권하고 싶은 행동을 오른쪽 큰 파란 버튼에:
  // 틀린 게 있으면 '오답 다시 풀기', 다 맞았으면 '새 문제 풀기'.
  const wrongCount = getWrongIds(state.subject.id).length;
  const retry = $("retry-btn");
  if (wrongCount > 0) {
    retry.textContent = "틀린 문제 다시 풀기";
    retry.onclick = () => startQuiz(state.subject, "wrong");
  } else {
    retry.textContent = "새 문제 풀기";
    retry.onclick = () => startQuiz(state.subject, "all");
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
// 마우스로 왔다 갔다 하는 것보다 훨씬 빨라요.
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
  $("home-btn").addEventListener("click", renderHome);
  $("quit-btn").addEventListener("click", renderHome);
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
