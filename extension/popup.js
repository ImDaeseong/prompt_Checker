const STORAGE_KEY = "prompt-checker-v4";
const $ = (id) => document.getElementById(id);
const POLL_INTERVAL = 2000;   // 2초마다 완료 확인
const MAX_WAIT_MS   = 5 * 60 * 1000; // 최대 5분 대기

// 패널이 열려 있는 동안 포트 유지 → 닫히면 background가 감지
// 변수에 저장해야 GC에 의해 수거되지 않음
const _keepAlivePort = chrome.runtime.connect({ name: "panel-alive" });

// ── 저장 / 불러오기 ───────────────────────────────────────────
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    prompt:   $("promptInput").value,
    question: $("questionInput").value,
    expected: $("expectedInput").value,
    target:   $("targetSel").value,
  }));
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

// ── 텍스트 조합 ───────────────────────────────────────────────
function buildText(prompt, question, expected) {
  const parts = [];

  if (prompt?.trim())   parts.push("[내 프롬프트]", prompt.trim());
  if (question?.trim()) parts.push("", "[테스트 질문]", question.trim());
  if (expected?.trim()) parts.push("", "[개선 방향]", expected.trim());

  parts.push(
    "",
    "---",
    "",
    "위 프롬프트를 테스트 질문에 적용하여 평가하고 개선하라.",
    "반드시 아래 형식으로만 출력하라. 다른 설명 일체 없음.",
    "",
    "교체 권장: [예 / 아니오]",
    "이유: [기존 프롬프트 대비 달라진 점과 개선 근거를 한 줄로]",
    "",
    "---",
    "",
    "[개선된 프롬프트]",
    "(개선된 프롬프트 전문을 여기에 출력)"
  );

  return parts.join("\n");
}

const TARGET_URLS = {
  chatgpt: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  gemini:  ["https://gemini.google.com/*"],
};

// ── 대상 탭 찾기 ──────────────────────────────────────────────
async function findTargetTab(target) {
  const tabs = await chrome.tabs.query({ url: TARGET_URLS[target] });
  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: "ping" });
      if (res?.target === target) return tab;
    } catch { /* content.js 없는 탭 무시 */ }
  }
  return null;
}

// ── 탭 상태 표시 ──────────────────────────────────────────────
async function refreshTabIndicator() {
  const selected = $("targetSel").value;
  const tabs = await chrome.tabs.query({ url: TARGET_URLS[selected] });
  let found = null;
  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: "ping" });
      if (res?.target === selected) { found = res.target; break; }
    } catch { /* 무시 */ }
  }
  if (found) {
    $("tabDot").className = "tab-dot " + found;
    $("tabLabel").textContent = found === "chatgpt" ? "ChatGPT 감지됨" : "Gemini 감지됨";
    $("notice").style.display = "none";
  } else {
    $("tabDot").className = "tab-dot none";
    $("tabLabel").textContent = "대상 탭 없음";
    $("notice").style.display = "";
  }
}

// ── 폴링 관리 ─────────────────────────────────────────────────
let pollTimer = null;

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  $("spinner").style.display = "none";
  $("testBtn").disabled = false;
}

function startPolling(tabId, target, baselineCount, startTime) {
  $("spinner").style.display = "inline-block";
  $("testBtn").disabled = true;
  $("runMsg").className = "msg";
  $("runMsg").textContent = "AI 응답 대기 중...";

  pollTimer = setInterval(async () => {
    // 5분 초과 시 중단
    if (Date.now() - startTime > MAX_WAIT_MS) {
      stopPolling();
      $("runMsg").className = "msg err";
      $("runMsg").textContent = "5분 초과 — AI 응답이 너무 오래 걸립니다.";
      return;
    }

    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: "getResult", target, baselineCount });

      if (res.ok) {
        stopPolling();
        $("resultBox").value = res.text;
        $("updateBtn").disabled = false;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        $("resultMeta").textContent = `${target === "chatgpt" ? "ChatGPT" : "Gemini"} · ${elapsed}초`;
        $("runMsg").className = "msg ok";
        $("runMsg").textContent = "완료";
      } else if (res.error?.includes("아직")) {
        // 생성 중 또는 아직 응답 없음 → 계속 대기
      } else {
        stopPolling();
        $("runMsg").className = "msg err";
        $("runMsg").textContent = "오류: " + res.error;
      }
    } catch {
      stopPolling();
      $("runMsg").className = "msg err";
      $("runMsg").textContent = "탭 연결이 끊겼습니다. 페이지를 새로고침하세요.";
    }
  }, POLL_INTERVAL);
}

// ── 테스트 실행 ───────────────────────────────────────────────
$("testBtn").addEventListener("click", async () => {
  const prompt   = $("promptInput").value;
  const question = $("questionInput").value;
  const expected = $("expectedInput").value;
  const target   = $("targetSel").value;

  if (!prompt.trim() && !question.trim()) {
    $("runMsg").className = "msg err";
    $("runMsg").textContent = "프롬프트 또는 질문을 입력하세요.";
    return;
  }

  // 이전 폴링 중단
  stopPolling();
  $("testBtn").disabled = true;
  $("spinner").style.display = "inline-block";
  $("runMsg").className = "msg";
  $("runMsg").textContent = "대상 탭 찾는 중...";
  $("resultBox").value = "";
  $("resultMeta").textContent = "";
  $("updateBtn").disabled = true;

  const tab = await findTargetTab(target);
  if (!tab) {
    $("runMsg").className = "msg err";
    $("runMsg").textContent = `${target === "chatgpt" ? "ChatGPT" : "Gemini"} 탭을 열고 새로고침하세요.`;
    stopPolling();
    return;
  }

  $("runMsg").textContent = "전송 중...";

  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      action: "submit",
      text: buildText(prompt, question, expected),
      target,
    });

    if (res.ok) {
      save();
      startPolling(tab.id, target, res.baselineCount ?? 0, Date.now());
    } else {
      stopPolling();
      $("runMsg").className = "msg err";
      $("runMsg").textContent = "전송 오류: " + res.error;
    }
  } catch {
    stopPolling();
    $("runMsg").className = "msg err";
    $("runMsg").textContent = "대상 탭을 새로고침한 뒤 다시 시도하세요.";
  }
});

// ── 개선된 프롬프트 추출 ─────────────────────────────────────
function extractImprovedPrompt(text) {
  // 1단계: [개선된 프롬프트] 마커
  const marker = "[개선된 프롬프트]";
  const markerIdx = text.indexOf(marker);
  if (markerIdx !== -1) {
    return text.slice(markerIdx + marker.length).trim();
  }

  // 2단계: 마지막 --- 구분선 이후 내용
  const lastSep = text.lastIndexOf("---");
  if (lastSep !== -1) {
    const after = text.slice(lastSep + 3).trim();
    const lines = after.split("\n");
    // 첫 줄이 라벨 줄이면 제거
    if (lines[0] && (lines[0].includes("개선") || lines[0].includes("프롬프트"))) {
      return lines.slice(1).join("\n").trim();
    }
    return after;
  }

  // 3단계: 교체 권장 / 이유 헤더 줄을 건너뛰고 나머지 반환
  const lines = text.split("\n");
  const bodyStart = lines.findIndex(
    (l, i) => i >= 2 && l.trim() && !l.startsWith("교체") && !l.startsWith("이유") && l.trim() !== "---"
  );
  return bodyStart === -1 ? text.trim() : lines.slice(bodyStart).join("\n").trim();
}

// ── 업데이트: 개선된 프롬프트 → 입력란 반영 ─────────────────
$("updateBtn").addEventListener("click", () => {
  const result = $("resultBox").value;
  if (!result) return;

  const improved = extractImprovedPrompt(result);
  $("promptInput").value = improved;
  save();

  $("updateBtn").textContent = "업데이트됨 ✓";
  setTimeout(() => { $("updateBtn").textContent = "업데이트"; }, 2000);
});

// ── 초기화 ────────────────────────────────────────────────────
["promptInput", "questionInput", "expectedInput"].forEach((id) =>
  $(id).addEventListener("input", save)
);
$("targetSel").addEventListener("change", () => { save(); refreshTabIndicator(); });

const DEFAULT_CRITERIA = [
  "- 역할과 지시사항이 명확한가",
  "- 모호한 표현 없이 구체적인가",
  "- 필요한 맥락이 충분히 포함됐는가",
  "- 지시사항 간 모순이 없는가",
  "- 원하는 출력 형식이 명시됐는가",
].join("\n");

const saved = load();
$("promptInput").value   = saved.prompt   || "";
$("questionInput").value = saved.question || "";
$("expectedInput").value = saved.expected || DEFAULT_CRITERIA;
if (["chatgpt", "gemini"].includes(saved.target)) $("targetSel").value = saved.target;

$("testBtn").disabled = false;
refreshTabIndicator();

// 패널에 포커스가 돌아올 때마다 탭 상태 갱신
window.addEventListener("focus", refreshTabIndicator);
