const SCALE_LABELS = [
  "전혀 그렇지 않다(1)",
  "그렇지 않다(2)",
  "보통이다(3)",
  "그렇다(4)",
  "매우 그렇다(5)",
];

const $ = (id) => document.getElementById(id);
let currentPassword = "";

function show(view) {
  $("view-login").classList.toggle("hidden", view !== "login");
  $("view-dash").classList.toggle("hidden", view !== "dash");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

async function fetchStats(password) {
  try {
    const res = await fetch("/api/admin/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

function renderStats(data) {
  $("stat-count").innerHTML = `${data.count}<small> 명</small>`;
  $("stat-avg").textContent = data.averageTotal;
  $("stat-max").textContent = data.maxScore;

  const pq = $("per-question");
  pq.innerHTML = "";
  if (data.count === 0) {
    pq.innerHTML = `<div class="empty">아직 응답이 없습니다.</div>`;
  } else {
    data.perQuestion.forEach((q) => {
      const pct = (q.average / 5) * 100;
      const distText = Array.isArray(q.distribution)
        ? q.distribution.map((cnt, i) => `${SCALE_LABELS[i]} ${cnt}`).join(" · ")
        : Object.entries(q.distribution || {})
            .map(([score, cnt]) => `${score}점 ${cnt}명`)
            .join(" · ");

      const row = document.createElement("div");
      row.className = "qbar";
      row.innerHTML = `
        <div class="qbar-head">
          <span class="qbar-text">${q.index}. ${escapeHtml(q.text)}</span>
          <span class="qbar-avg">${Number(q.average).toFixed(2)}</span>
        </div>
        <div class="qbar-track">
          <div class="qbar-fill" style="width:${pct}%"></div>
        </div>
        <div class="qbar-dist">${distText}</div>`;
      pq.appendChild(row);
    });
  }

  const tbody = $("individuals-body");
  tbody.innerHTML = "";
  if (data.count === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">아직 응답이 없습니다.</td></tr>`;
  } else {
    const sorted = [...(data.individuals || [])].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    for (const p of sorted) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(p.affiliation)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td class="score">${p.total}</td>
        <td>${formatDate(p.createdAt)}</td>`;
      tbody.appendChild(tr);
    }
  }
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("password").value.trim();
  const err = $("login-error");
  const btn = $("btn-login");
  err.textContent = "";
  btn.disabled = true;
  try {
    const { ok, status, data } = await fetchStats(password);
    if (!ok) {
      if (status === 401) {
        err.textContent = "암호가 올바르지 않습니다.";
      } else {
        err.textContent = "오류: " + (data.error || "서버 응답 오류");
      }
      return;
    }
    currentPassword = password;
    renderStats(data);
    show("dash");
  } catch (errCatch) {
    err.textContent = "오류 발생: " + errCatch.message;
  } finally {
    btn.disabled = false;
  }
});

$("btn-refresh").addEventListener("click", async () => {
  const btn = $("btn-refresh");
  btn.disabled = true;
  btn.textContent = "불러오는 중…";
  try {
    const { ok, data } = await fetchStats(currentPassword);
    if (ok) renderStats(data);
  } catch (refreshError) {
    void refreshError;
  } finally {
    btn.disabled = false;
    btn.textContent = "새로고침";
  }
});

$("btn-reset").addEventListener("click", async () => {
  const confirmed = window.confirm(
    "지금까지의 모든 응답을 삭제합니다.\n삭제된 데이터는 되돌릴 수 없습니다.\n\n정말 초기화하시겠습니까?"
  );
  if (!confirmed) return;

  const btn = $("btn-reset");
  const msg = $("reset-msg");
  btn.disabled = true;
  btn.textContent = "초기화 중…";
  msg.textContent = "";
  msg.classList.remove("is-error");
  try {
    const res = await fetch("/api/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: currentPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || "초기화에 실패했습니다.";
      msg.classList.add("is-error");
      return;
    }
    const refreshed = await fetchStats(currentPassword);
    if (refreshed.ok) renderStats(refreshed.data);
    msg.textContent = "모든 응답을 초기화했습니다. 이후 응답부터 다시 집계됩니다.";
  } catch (resetError) {
    msg.textContent = "오류로 초기화에 실패했습니다: " + resetError.message;
    msg.classList.add("is-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "응답 전체 초기화";
  }
});
