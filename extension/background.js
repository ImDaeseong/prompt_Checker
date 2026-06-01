chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(console.error);

let panelWindowId = null;

// 아이콘 클릭 → 윈도우 레벨로 패널 열기
chrome.action.onClicked.addListener((tab) => {
  panelWindowId = tab.windowId;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});

// 탭 전환 시 동일 윈도우면 패널 유지
chrome.tabs.onActivated.addListener(({ windowId }) => {
  if (panelWindowId === windowId) {
    chrome.sidePanel.open({ windowId }).catch(() => {});
  }
});

// 윈도우 닫히면 추적 해제
chrome.windows.onRemoved.addListener((windowId) => {
  if (panelWindowId === windowId) panelWindowId = null;
});

// 패널 페이지가 닫히면(X 버튼) 포트 끊김 → 재열기 중지
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "panel-alive") {
    port.onDisconnect.addListener(() => {
      panelWindowId = null;
    });
  }
});
