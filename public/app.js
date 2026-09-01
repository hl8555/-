const SCALE = [
  { value: 5, text: "매우 그렇다" },
  { value: 4, text: "그렇다" },
  { value: 3, text: "보통이다" },
  { value: 2, text: "그렇지 않다" },
  { value: 1, text: "전혀 그렇지 않다" },
];

const state = {
  affiliation: "",
  name: "",
  questions: [],
  maxScore: 50,
};

const $ = (id) => document.getElementById(id);

function show(view) {
  for (const id of ["view-intro", "view-test", "view-result"]) {
    $(id).classList.toggle("hidden", id !== view);
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function loadQuestions() {
  const res = await fetch("/api/questions");
  const data = await res.json();
  state.questions = data.questions;
  state.maxScore = data.maxScore;
  $("result-max").textContent = ` / ${data.maxScore}점`;
}

function renderQuestions() {
  const container = $("questions");
  container.innerHTML = "";
  state.questions.forEach((q, qi) => {
    const block = document.createElement("div");
    block.className = "question";

    const head = document.createElement("div");
    head.className = "q-head";
    head.innerHTML = `<span class="q-num">${qi + 1}</span><div class="q-text">${escapeHtml(
      q
    )}</div>`;
    block.appendChild(head);

    const scale = document.createElement("div");
    scale.className = "scale";
    scale.setAttribute("role", "radiogroup");
    scale.setAttribute("aria-label", `${qi + 1}번 문항 응답`);

    SCALE.forEach((opt) => {
      const wrap = document.createElement("div");
      wrap.className = "scale-opt";
      const inputId = `q${qi}_${opt.value}`;
      wrap.innerHTML = `
        <input type="radio" id="${inputId}" name="q${qi}" value="${opt.value}" />
        <label for="${inputId}">
          <span class="num">${opt.value}</span>
          <span class="txt">${opt.text}</span>
        </label>`;
      scale.appendChild(wrap);
    });

    block.appendChild(scale);
    container.appendChild(block);
  });

  container.addEventListener("change", updateProgress);
  updateProgress();
}

function getAnswers() {
  return state.questions.map((_, qi) => {
    const checked = document.querySelector(`input[name="q${qi}"]:checked`);
    return checked ? Number(checked.value) : null;
  });
}

function updateProgress() {
  const answers = getAnswers();
  const done = answers.filter((a) => a !== null).length;
  const total = state.questions.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("progress-bar").style.width = `${pct}%`;
  $("progress-label").textContent = `${done} / ${total} 문항 응답`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

$("form-intro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const affiliation = $("affiliation").value.trim();
  const name = $("name").value.trim();
  const err = $("intro-error");
  if (!affiliation || !name) {
    err.textContent = "소속과 이름을 모두 입력해 주세요.";
    return;
  }
  err.textContent = "";
  state.affiliation = affiliation;
  state.name = name;
  renderQuestions();
  show("view-test");
});

$("btn-back").addEventListener("click", () => {
  show("view-intro");
});

$("form-test").addEventListener("submit", async (e) => {
  e.preventDefault();
  const answers = getAnswers();
  const err = $("test-error");
  const firstMissing = answers.findIndex((a) => a === null);
  if (firstMissing !== -1) {
    err.textContent = `${firstMissing + 1}번 문항에 아직 응답하지 않았습니다.`;
    const el = document.querySelector(`input[name="q${firstMissing}"]`);
    el?.closest(".question")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  err.textContent = "";

  const btn = $("btn-submit");
  btn.disabled = true;
  btn.textContent = "제출 중…";
  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        affiliation: state.affiliation,
        name: state.name,
        answers,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || "제출에 실패했습니다.";
      return;
    }
    showResult(data);
  } catch {
    err.textContent = "네트워크 오류로 제출에 실패했습니다. 다시 시도해 주세요.";
  } finally {
    btn.disabled = false;
    btn.textContent = "제출하고 점수 보기";
  }
});

function showResult(data) {
  $("result-name").textContent = `${data.affiliation} · ${data.name} 님의 결과`;
  $("result-score").textContent = data.total;
  $("result-max").textContent = ` / ${data.maxScore}점`;
  show("view-result");
  const pct = data.maxScore ? (data.total / data.maxScore) * 100 : 0;
  requestAnimationFrame(() => {
    $("result-fill").style.width = `${pct}%`;
  });
}

$("btn-restart").addEventListener("click", () => {
  $("form-intro").reset();
  $("form-test").reset();
  state.affiliation = "";
  state.name = "";
  show("view-intro");
});

loadQuestions().catch(() => {
  $("intro-error").textContent = "문항을 불러오지 못했습니다. 새로고침해 주세요.";
});
