const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 다중 셀렉터 순서대로 시도 ─────────────────────────────────
function findEl(...selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch { /* 잘못된 셀렉터 무시 */ }
  }
  return null;
}

// ── 텍스트 삽입 ───────────────────────────────────────────────
// execCommand는 deprecated이나 ProseMirror(ChatGPT)/Quill(Gemini) 에디터에
// contenteditable을 통해 텍스트를 삽입하는 유일하게 신뢰할 수 있는 방법이다.
// InputEvent 기반 대안은 두 프레임워크 모두 내부 상태 불일치를 유발한다.
function insertText(el, text) {
  el.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("insertText", false, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// ── ChatGPT 전송 ──────────────────────────────────────────────
async function submitChatGPT(text) {
  const inputEl = findEl(
    "#prompt-textarea",
    'div[id="prompt-textarea"][contenteditable]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][data-virtualkeyboard]',
    'main div[contenteditable="true"]',
    'form div[contenteditable="true"]'
  );
  if (!inputEl) throw new Error("ChatGPT 입력창을 찾을 수 없습니다. 페이지를 새로고침하세요.");

  insertText(inputEl, text);
  await sleep(600);

  const sendBtn = findEl(
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="메시지 보내기"]'
  );
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
  } else {
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  }
}

// ── Gemini 전송 ───────────────────────────────────────────────
async function submitGemini(text) {
  const inputEl = findEl(
    '.ql-editor[contenteditable="true"]',
    "rich-textarea .ql-editor",
    'rich-textarea [contenteditable="true"]',
    '[contenteditable="true"][data-testid]',
    'div[contenteditable="true"]'
  );
  if (!inputEl) throw new Error("Gemini 입력창을 찾을 수 없습니다. 페이지를 새로고침하세요.");

  insertText(inputEl, text);
  await sleep(600);

  const sendBtn = findEl(
    'button[aria-label="Send message"]',
    'button[aria-label="메시지 보내기"]',
    "button.send-button",
    'button[data-testid="send-button"]'
  );
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
  } else {
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  }
}

// ── ChatGPT 응답 추출 ─────────────────────────────────────────
function getLastChatGPTResult() {
  const stopBtn = findEl(
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="생성 중지"]'
  );
  if (stopBtn) throw new Error("아직 응답 생성 중입니다.");

  const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (!msgs.length) throw new Error("응답이 아직 없습니다.");
  return msgs[msgs.length - 1].innerText.trim();
}

function getChatGPTState() {
  return {
    count: document.querySelectorAll('[data-message-author-role="assistant"]').length,
  };
}

// ── Gemini 응답 추출 ──────────────────────────────────────────
function getLastGeminiResult() {
  const stopBtn = findEl(
    "button[aria-label='Stop generating']",
    "button[aria-label='생성 중지']"
  );
  if (stopBtn) throw new Error("아직 응답 생성 중입니다.");

  const responses = document.querySelectorAll(
    "model-response message-content, model-response .markdown, .model-response-text"
  );
  if (responses.length) return responses[responses.length - 1].innerText.trim();

  const fallback = document.querySelectorAll(
    "model-response, [data-response-index], .response-content"
  );
  if (fallback.length) return fallback[fallback.length - 1].innerText.trim();

  throw new Error("응답이 아직 없습니다.");
}

function getGeminiResponses() {
  const responses = document.querySelectorAll(
    "model-response message-content, model-response .markdown, .model-response-text"
  );
  if (responses.length) return responses;

  return document.querySelectorAll(
    "model-response, [data-response-index], .response-content"
  );
}

function getGeminiState() {
  return {
    count: getGeminiResponses().length,
  };
}

function getTargetState(target) {
  return target === "gemini" ? getGeminiState() : getChatGPTState();
}

function getNewResult(target, baselineCount) {
  const state = getTargetState(target);
  if (state.count <= baselineCount) {
    throw new Error("새 응답이 아직 없습니다.");
  }

  return target === "gemini" ? getLastGeminiResult() : getLastChatGPTResult();
}

// ── 메시지 리스너 ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "ping") {
    const url = location.href;
    if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) {
      sendResponse({ target: "chatgpt" });
    } else if (url.includes("gemini.google.com")) {
      sendResponse({ target: "gemini" });
    } else {
      sendResponse({ target: null });
    }
    return;
  }

  if (msg.action === "submit") {
    const fn = msg.target === "gemini" ? submitGemini : submitChatGPT;
    const before = getTargetState(msg.target);
    fn(msg.text)
      .then(() => sendResponse({ ok: true, baselineCount: before.count }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "getResult") {
    try {
      const baselineCount = Number.isFinite(msg.baselineCount) ? msg.baselineCount : 0;
      const text = getNewResult(msg.target, baselineCount);
      sendResponse({ ok: true, text });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return;
  }
});
