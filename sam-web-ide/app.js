function getCheerpJAppBase() {
  let path = window.location.pathname || "/";

  // If this page was loaded through an explicit file URL such as /index.html,
  // strip the filename so /app still points at the containing web directory.
  if (!path.endsWith("/")) {
    const lastSlash = path.lastIndexOf("/");
    path = path.slice(0, lastSlash + 1);
  }

  // CheerpJ mounts the web-server root at /app. Preserve any deployment
  // subdirectory (for example /sam-web-ide/) beneath that mount.
  const normalized = path.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return `/app${normalized}` || "/app";
}

const SAM_APP_BASE = getCheerpJAppBase();
const SAM_BRIDGE_JAR = `${SAM_APP_BASE}/jar/sam-web-bridge.jar`;
const SAM_RUNTIME_JAR = `${SAM_APP_BASE}/jar/SaM-2.6.3.jar`;
const SAM_CLASSPATH = `${SAM_BRIDGE_JAR}:${SAM_RUNTIME_JAR}`;
const WORKSPACE_KEY = "sam-web-ide-workspace-v13";
const SETTINGS_KEY = "sam-web-ide-settings-v13";
const SPLIT_KEY = "sam-web-ide-split-v13";
const HELP_SEEN_KEY = "sam-web-ide-help-seen-v14";
const MOBILE_VIEW_KEY = "sam-web-ide-mobile-view-v14";

const SHARE_VERSION = "1";

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeSharePayload(tab) {
  const payload = JSON.stringify({
    v: SHARE_VERSION,
    filename: normalizeFilename(tab.filename),
    source: tab.source,
  });
  return bytesToBase64Url(new TextEncoder().encode(payload));
}

function decodeSharePayload(value) {
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
  if (!payload || String(payload.v) !== SHARE_VERSION || typeof payload.source !== "string") {
    throw new Error("Unsupported shared program");
  }
  return {
    filename: normalizeFilename(payload.filename || "shared.sam"),
    source: payload.source,
  };
}

function sharedProgramFromLocation() {
  if (!window.location.hash.startsWith("#share=")) return null;
  try {
    return decodeSharePayload(window.location.hash.slice("#share=".length));
  } catch (error) {
    console.warn("Could not decode shared SaM program", error);
    return { error };
  }
}

function clearShareFragment() {
  if (!window.location.hash.startsWith("#share=")) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

const starterProgram = `// SaM Web IDE\n// Edit this program, then Run or Step.\n\nPUSHIMM 10\nPUSHIMM 20\nADD\nWRITE\nSTOP\n`;

const instructionOperands = {
  ADDSP: "int", JSR: "label", JUMP: "label", JUMPC: "label",
  LSHIFT: "int", PUSHABS: "int", PUSHIMM: "int", PUSHIMMCH: "char",
  PUSHIMMF: "float", PUSHIMMMA: "int", PUSHIMMPA: "label",
  PUSHIMMSTR: "string", PUSHOFF: "int", RSHIFT: "int",
  STOREABS: "int", STOREOFF: "int",
};

const opcodes = new Set(`
ADD ADDF ADDSP AND BITAND BITNAND BITNOR BITNOT BITOR BITXOR
CMP CMPF DIV DIVF DUP EQUAL FREE FTOI FTOIR GREATER ISNEG ISNIL ISPOS
ITOF JSR JSRIND JUMP JUMPC JUMPIND LESS LINK LSHIFT LSHIFTIND MALLOC
MOD NAND NOR NOT OR POPFBR POPSP PUSHABS PUSHFBR PUSHIMM PUSHIMMCH
PUSHIMMF PUSHIMMMA PUSHIMMPA PUSHIMMSTR PUSHIND PUSHOFF PUSHSP READ
READCH READF READSTR RSHIFT RSHIFTIND RST SKIP STOP STOREABS STOREIND
STOREOFF SUB SUBF SWAP TIMES TIMESF UNLINK WRITE WRITECH WRITEF WRITESTR XOR
`.trim().split(/\s+/));

const operandDescriptions = {
  int: "integer operand",
  float: "floating-point operand",
  char: "character literal",
  string: "string literal",
  label: "target label/address",
};

function instructionCompletion(opcode) {
  const operand = instructionOperands[opcode] || "";
  return {
    text: opcode,
    insertText: operand ? `${opcode} ` : opcode,
    kind: "instruction",
    signature: operand ? `${opcode} ${operand}` : opcode,
    detail: operand ? operandDescriptions[operand] : "no operands",
    operand,
  };
}

CodeMirror.defineMode("sam", () => ({
  startState() { return {}; },
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/^\"(?:[^\"\\]|\\.)*\"/)) return "string";
    if (stream.match(/^'(?:[^'\\]|\\.)'/)) return "string";
    if (stream.match(/^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^[+-]?\d+/)) return "number";
    if (stream.match(/^[A-Za-z_.$][\w.$-]*(?=:)/)) return "def";
    if (stream.peek() === ":") { stream.next(); return "punctuation"; }
    if (stream.match(/^[A-Za-z_.$][\w.$-]*/)) {
      const word = stream.current().toUpperCase();
      return opcodes.has(word) ? "keyword" : "variable";
    }
    stream.next();
    return null;
  },
  lineComment: "//"
}));

const runtimeStatus = document.querySelector("#runtimeStatus");
const filenameInput = document.querySelector("#filenameInput");
const cursorStatus = document.querySelector("#cursorStatus");
const executionStatus = document.querySelector("#executionStatus");
const fileInput = document.querySelector("#fileInput");
const shareBtn = document.querySelector("#shareBtn");
const runBtn = document.querySelector("#runBtn");
const stepBtn = document.querySelector("#stepBtn");
const resetBtn = document.querySelector("#resetBtn");
const stopBtn = document.querySelector("#stopBtn");
const toast = document.querySelector("#toast");
const placeholder = document.querySelector("#samPlaceholder");
const diagnostics = document.querySelector("#diagnostics");
const diagnosticMessage = document.querySelector("#diagnosticMessage");
let toastTimer;
let samGui = null;
let lastLoadedSource = null;
let instructionLines = [];
let executionLine = null;
let executionGutterLine = null;
let diagnosticLineHandle = null;
let diagnosticGutterLine = null;
let pcPollTimer = null;
let lastPC = -2;

function normalizeFilename(name) {
  const cleaned = (name || "untitled.sam").trim().replace(/[\\/:*?\"<>|]/g, "_");
  if (!cleaned) return "untitled.sam";
  return cleaned.toLowerCase().endsWith(".sam") ? cleaned : `${cleaned}.sam`;
}
function makeTab({ filename = "untitled.sam", source = starterProgram, dirty = true } = {}) {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    filename: normalizeFilename(filename), source, dirty,
    cursor: { line: 0, ch: 0 }, scrollTop: 0,
  };
}
function legacyWorkspace() {
  let source = starterProgram;
  let filename = "untitled.sam";
  try {
    source = localStorage.getItem("sam-web-ide-source-v10")
      || localStorage.getItem("sam-web-ide-source-v9")
      || localStorage.getItem("sam-web-ide-source-v8")
      || localStorage.getItem("sam-web-ide-source-v7")
      || localStorage.getItem("sam-web-ide-source-v6")
      || localStorage.getItem("sam-web-ide-source-v5") || starterProgram;
    filename = normalizeFilename(localStorage.getItem("sam-web-ide-filename-v1") || "untitled.sam");
  } catch {}
  const tab = makeTab({ filename, source, dirty: source !== starterProgram });
  return { activeId: tab.id, tabs: [tab] };
}
function loadWorkspace() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "null");
    if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
      parsed.tabs = parsed.tabs.map(tab => ({ ...makeTab(), ...tab, filename: normalizeFilename(tab.filename) }));
      if (!parsed.tabs.some(tab => tab.id === parsed.activeId)) parsed.activeId = parsed.tabs[0].id;
      return parsed;
    }
  } catch (error) { console.warn("Could not restore workspace", error); }
  return legacyWorkspace();
}
const defaultSettings = {
  theme: "dark", fontSize: 14, fontFamily: "system-mono",
  tabWidth: 2, lineWrapping: true, pcHighlight: true,
};
function loadSettings() {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...defaultSettings }; }
}
let workspaceState = loadWorkspace();
let editorSettings = loadSettings();
let switchingTabs = false;
const tabsHost = document.querySelector("#tabs");
const newTabBtn = document.querySelector("#newTabBtn");
const settingsBtn = document.querySelector("#settingsBtn");
const settingsPanel = document.querySelector("#settingsPanel");
const themeSelect = document.querySelector("#themeSelect");
const fontSizeInput = document.querySelector("#fontSizeInput");
const fontSizeOutput = document.querySelector("#fontSizeOutput");
const fontFamilySelect = document.querySelector("#fontFamilySelect");
const tabWidthSelect = document.querySelector("#tabWidthSelect");
const lineWrapInput = document.querySelector("#lineWrapInput");
const pcHighlightInput = document.querySelector("#pcHighlightInput");
const aboutHelpBtn = document.querySelector("#aboutHelpBtn");
const helpModal = document.querySelector("#helpModal");
const helpCloseBtn = document.querySelector("#helpCloseBtn");
const helpDoneBtn = document.querySelector("#helpDoneBtn");
const showHelpOnStartInput = document.querySelector("#showHelpOnStartInput");
const workspaceEl = document.querySelector(".workspace");
const mobileEditorBtn = document.querySelector("#mobileEditorBtn");
const mobileSimulatorBtn = document.querySelector("#mobileSimulatorBtn");

function activeTab() { return workspaceState.tabs.find(tab => tab.id === workspaceState.activeId) || workspaceState.tabs[0]; }
function persistWorkspace() {
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaceState)); } catch {}
}
function persistSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(editorSettings)); } catch {}
}

const editor = CodeMirror(document.querySelector("#editor"), {
  value: activeTab().source, mode: "sam", theme: "samweb", lineNumbers: true,
  gutters: ["CodeMirror-linenumbers", "execution-gutter", "diagnostics-gutter"],
  lineWrapping: editorSettings.lineWrapping, styleActiveLine: true, matchBrackets: true,
  autoCloseBrackets: true, indentUnit: editorSettings.tabWidth, tabSize: editorSettings.tabWidth,
  indentWithTabs: false, cursorBlinkRate: 530,
});
editor.setSize("100%", "100%");

function fontFamilyValue(setting) {
  if (setting === "courier") return '"Courier New", Courier, monospace';
  if (setting === "menlo") return 'Menlo, Consolas, "Liberation Mono", monospace';
  return '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
}
function applySettings({ refresh = true } = {}) {
  document.documentElement.dataset.theme = editorSettings.theme;
  document.documentElement.style.setProperty("--editor-font-size", `${editorSettings.fontSize}px`);
  document.documentElement.style.setProperty("--editor-font-family", fontFamilyValue(editorSettings.fontFamily));
  editor.setOption("lineWrapping", !!editorSettings.lineWrapping);
  editor.setOption("tabSize", Number(editorSettings.tabWidth));
  editor.setOption("indentUnit", Number(editorSettings.tabWidth));
  themeSelect.value = editorSettings.theme;
  fontSizeInput.value = editorSettings.fontSize;
  fontSizeOutput.textContent = `${editorSettings.fontSize}px`;
  fontFamilySelect.value = editorSettings.fontFamily;
  tabWidthSelect.value = String(editorSettings.tabWidth);
  lineWrapInput.checked = !!editorSettings.lineWrapping;
  pcHighlightInput.checked = !!editorSettings.pcHighlight;
  if (!editorSettings.pcHighlight && executionLine !== null) editor.removeLineClass(executionLine, "text", "sam-current-instruction-text");
  if (refresh) setTimeout(() => editor.refresh(), 0);
}
function saveActiveEditorState() {
  const tab = activeTab();
  if (!tab) return;
  tab.source = editor.getValue();
  tab.cursor = editor.getCursor();
  tab.scrollTop = editor.getScrollInfo().top;
}
function renderTabs() {
  tabsHost.replaceChildren();
  for (const tab of workspaceState.tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `editor-tab${tab.id === workspaceState.activeId ? " active" : ""}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", tab.id === workspaceState.activeId ? "true" : "false");
    button.title = tab.filename;
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = tab.filename;
    const dirty = document.createElement("span");
    dirty.className = "tab-dirty";
    dirty.textContent = tab.dirty ? "•" : "";
    dirty.title = tab.dirty ? "Modified" : "";
    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = `Close ${tab.filename}`;
    close.addEventListener("click", event => { event.stopPropagation(); closeTab(tab.id); });
    button.append(name, dirty, close);
    button.addEventListener("click", () => switchTab(tab.id));
    tabsHost.appendChild(button);
  }
}
function updateActiveTabUI() {
  const tab = activeTab();
  filenameInput.value = tab.filename;
  document.title = `${tab.filename} — SaM Web IDE`;
  renderTabs();
}
function switchTab(id) {
  if (id === workspaceState.activeId) return;
  saveActiveEditorState();
  workspaceState.activeId = id;
  const tab = activeTab();
  switchingTabs = true;
  clearDiagnostics(); clearExecutionHighlight(); lastLoadedSource = null; instructionLines = [];
  editor.setValue(tab.source);
  editor.setCursor(tab.cursor || { line: 0, ch: 0 });
  editor.scrollTo(null, tab.scrollTop || 0);
  switchingTabs = false;
  updateActiveTabUI(); persistWorkspace(); updateCursorStatus(); editor.focus();
}
function createNewTab({ filename = "untitled.sam", source = starterProgram, dirty = true, selectStem = true } = {}) {
  saveActiveEditorState();
  const tab = makeTab({ filename, source, dirty });
  workspaceState.tabs.push(tab);
  workspaceState.activeId = tab.id;
  switchingTabs = true;
  clearDiagnostics(); clearExecutionHighlight(); lastLoadedSource = null; instructionLines = [];
  editor.setValue(tab.source); editor.setCursor({ line: 0, ch: 0 }); editor.scrollTo(null, 0);
  switchingTabs = false;
  updateActiveTabUI(); persistWorkspace(); editor.focus();
  if (selectStem) {
    const end = Math.max(0, filenameInput.value.toLowerCase().lastIndexOf(".sam"));
    filenameInput.focus(); filenameInput.setSelectionRange(0, end || filenameInput.value.length);
  }
  return tab;
}
function closeTab(id = workspaceState.activeId) {
  const tab = workspaceState.tabs.find(item => item.id === id);
  if (!tab) return;
  if (tab.dirty && !window.confirm(`${tab.filename} has changes that have not been downloaded. Close it anyway?`)) return;
  saveActiveEditorState();
  const index = workspaceState.tabs.findIndex(item => item.id === id);
  workspaceState.tabs.splice(index, 1);
  if (!workspaceState.tabs.length) workspaceState.tabs.push(makeTab());
  if (workspaceState.activeId === id) workspaceState.activeId = workspaceState.tabs[Math.min(index, workspaceState.tabs.length - 1)].id;
  const next = activeTab();
  switchingTabs = true;
  clearDiagnostics(); clearExecutionHighlight(); lastLoadedSource = null; instructionLines = [];
  editor.setValue(next.source); editor.setCursor(next.cursor || { line: 0, ch: 0 }); editor.scrollTo(null, next.scrollTop || 0);
  switchingTabs = false;
  updateActiveTabUI(); persistWorkspace(); editor.focus();
}

applySettings({ refresh: false });
updateActiveTabUI();

// Lightweight SaM autocomplete: ISA opcodes + labels in the current buffer.
const completionPopup = document.createElement("div");
completionPopup.className = "sam-completion-popup";
completionPopup.hidden = true;
document.body.appendChild(completionPopup);
let completionItems = [];
let completionIndex = 0;
let completionFrom = null;

function sourceLabels() {
  const labels = new Set();
  for (const line of editor.getValue().split(/\r?\n/)) {
    const code = line.replace(/\/\/.*$/, "");
    const match = code.match(/^\s*([A-Za-z_.$][\w.$-]*)\s*:/);
    if (match) labels.add(match[1]);
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

function completionToken() {
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  let start = cursor.ch;
  while (start > 0 && /[A-Za-z0-9_.$-]/.test(line.charAt(start - 1))) start -= 1;
  return { cursor, start, text: line.slice(start, cursor.ch) };
}

function hideCompletions() {
  completionPopup.hidden = true;
  completionPopup.replaceChildren();
  completionItems = [];
  completionFrom = null;
}

function chooseCompletion(index) {
  if (!completionFrom || !completionItems.length) return;
  const item = completionItems[index];
  const cursor = editor.getCursor();
  editor.replaceRange(item.insertText || item.text, completionFrom, cursor, "+autocomplete");
  hideCompletions();
  editor.focus();
}

function renderCompletions() {
  completionPopup.replaceChildren();
  completionItems.forEach((item, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `sam-completion-item${index === completionIndex ? " selected" : ""}`;
    row.innerHTML = `
      <span class="completion-main">
        <span class="completion-signature"></span>
        <span class="completion-detail"></span>
      </span>
      <span class="completion-kind"></span>`;
    row.querySelector(".completion-signature").textContent = item.signature || item.text;
    row.querySelector(".completion-detail").textContent = item.detail || "";
    row.querySelector(".completion-kind").textContent = item.kind;
    row.addEventListener("mousedown", event => {
      event.preventDefault();
      chooseCompletion(index);
    });
    completionPopup.appendChild(row);
  });
}

function showCompletions({ explicit = false } = {}) {
  const { cursor, start, text } = completionToken();
  if (!explicit && text.length < 2) { hideCompletions(); return; }
  const prefix = text.toUpperCase();
  const lineBeforeToken = editor.getLine(cursor.line).slice(0, start);
  const opcodeMatch = lineBeforeToken.match(/^\s*([A-Za-z]+)\s+$/);
  const argumentOpcode = opcodeMatch ? opcodeMatch[1].toUpperCase() : null;
  const expectedOperand = argumentOpcode ? instructionOperands[argumentOpcode] : null;

  const opcodeItems = expectedOperand ? [] : [...opcodes]
    .filter(op => !prefix || op.startsWith(prefix))
    .sort()
    .map(instructionCompletion);

  const labelItems = sourceLabels()
    .filter(label => !text || label.toUpperCase().startsWith(prefix))
    .map(text => ({
      text, insertText: text, kind: "label", signature: text, detail: "source label"
    }));

  // In a label/address operand position, show only labels. Else include labels after opcodes.
  completionItems = expectedOperand === "label" ? labelItems.slice(0, 14)
    : [...opcodeItems, ...labelItems].slice(0, 14);
  if (!completionItems.length || (!explicit && completionItems.length === 1 && completionItems[0].text === text.toUpperCase())) {
    hideCompletions();
    return;
  }
  completionIndex = 0;
  completionFrom = { line: cursor.line, ch: start };
  const coords = editor.cursorCoords(cursor, "page");
  completionPopup.style.left = `${coords.left}px`;
  completionPopup.style.top = `${coords.bottom + 4}px`;
  completionPopup.hidden = false;
  renderCompletions();
}

editor.addKeyMap({
  "Ctrl-Space": () => showCompletions({ explicit: true }),
  "Cmd-Space": () => showCompletions({ explicit: true }),
  Up: () => {
    if (completionPopup.hidden) return CodeMirror.Pass;
    completionIndex = (completionIndex - 1 + completionItems.length) % completionItems.length;
    renderCompletions();
  },
  Down: () => {
    if (completionPopup.hidden) return CodeMirror.Pass;
    completionIndex = (completionIndex + 1) % completionItems.length;
    renderCompletions();
  },
  Enter: () => {
    if (completionPopup.hidden) return CodeMirror.Pass;
    chooseCompletion(completionIndex);
  },
  Tab: () => {
    if (completionPopup.hidden) return CodeMirror.Pass;
    chooseCompletion(completionIndex);
  },
  Esc: () => {
    if (completionPopup.hidden) return CodeMirror.Pass;
    hideCompletions();
  }
});

function updateCompletionsAfterEdit(change) {
  // Drive completion from actual editor edits rather than raw key-up events.
  // This avoids modifier keys (notably Shift while typing uppercase SaM opcodes)
  // dismissing an otherwise valid popup.
  if (!change || change.origin === "+autocomplete" || change.origin === "setValue") return;

  const { text } = completionToken();
  if (text.length >= 2) showCompletions();
  else hideCompletions();
}

editor.on("blur", (_cm, event) => {
  // Keep the popup alive when interacting with it; close only when focus really
  // leaves both CodeMirror and the completion list.
  setTimeout(() => {
    if (!completionPopup.matches(":hover")) hideCompletions();
  }, 160);
});

function updateCursorStatus() {
  const pos = editor.getCursor();
  cursorStatus.textContent = `Ln ${pos.line + 1}, Col ${pos.ch + 1}`;
}
function markDirty() {
  clearDiagnostics();
  clearExecutionHighlight();
  if (lastLoadedSource !== editor.getValue()) instructionLines = [];
  const tab = activeTab();
  if (!switchingTabs && tab) {
    tab.source = editor.getValue();
    tab.cursor = editor.getCursor();
    tab.dirty = true;
    persistWorkspace();
    renderTabs();
  }
  executionStatus.textContent = lastLoadedSource === editor.getValue() ? "Loaded" : "Modified";
}
editor.on("change", (_cm, change) => {
  updateCursorStatus();
  if (!switchingTabs) markDirty();
  updateCompletionsAfterEdit(change);
});
editor.on("cursorActivity", () => {
  updateCursorStatus();
  const tab = activeTab();
  if (tab && !switchingTabs) { tab.cursor = editor.getCursor(); persistWorkspace(); }
});
editor.on("scroll", () => {
  const tab = activeTab();
  if (tab && !switchingTabs) { tab.scrollTop = editor.getScrollInfo().top; persistWorkspace(); }
});
updateCursorStatus();

function setEditorText(text) { editor.setValue(text); editor.focus(); }
function sourceText() { return editor.getValue(); }
function currentFilename() { return activeTab()?.filename || normalizeFilename(filenameInput.value); }

function notify(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function setFilenameAndPersist() {
  const tab = activeTab();
  if (!tab) return;
  const next = normalizeFilename(filenameInput.value);
  if (tab.filename !== next) tab.dirty = true;
  tab.filename = next;
  filenameInput.value = next;
  persistWorkspace(); renderTabs();
}
filenameInput.addEventListener("input", () => {
  const tab = activeTab();
  if (!tab) return;
  tab.filename = filenameInput.value || "untitled.sam";
  tab.dirty = true; persistWorkspace(); renderTabs();
});
filenameInput.addEventListener("change", setFilenameAndPersist);
filenameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { setFilenameAndPersist(); editor.focus(); }
});

function setSimulatorControls(enabled) {
  for (const button of [runBtn, stepBtn, resetBtn, stopBtn]) button.disabled = !enabled;
}
function errorText(error) {
  const text = String(error?.message || error || "Unknown error");
  return text.replace(/^java\.lang\.[^:]+:\s*/, "");
}

function downloadSource() {
  setFilenameAndPersist();
  const blob = new Blob([sourceText()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = currentFilename(); document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  const tab = activeTab();
  if (tab) { tab.source = sourceText(); tab.dirty = false; persistWorkspace(); renderTabs(); }
  notify(`Downloaded ${currentFilename()}.`);
}

function clearDiagnostics() {
  diagnostics.hidden = true;
  diagnosticMessage.textContent = "";
  if (diagnosticLineHandle) { diagnosticLineHandle.clear(); diagnosticLineHandle = null; }
  if (diagnosticGutterLine !== null) {
    editor.setGutterMarker(diagnosticGutterLine, "diagnostics-gutter", null);
    diagnosticGutterLine = null;
  }
}
function showDiagnostic(lineNumber, message) {
  clearDiagnostics();
  const safeLine = Math.max(1, Number(lineNumber) || 1);
  const line = Math.min(editor.lineCount() - 1, safeLine - 1);
  diagnostics.hidden = false;
  diagnosticMessage.textContent = `Line ${line + 1}: ${message}`;
  diagnosticLineHandle = editor.markText(
    { line, ch: 0 }, { line, ch: editor.getLine(line).length },
    { className: "sam-assembler-error", title: message }
  );
  const marker = document.createElement("span");
  marker.className = "diagnostic-marker";
  marker.textContent = "●";
  marker.title = message;
  editor.setGutterMarker(line, "diagnostics-gutter", marker);
  diagnosticGutterLine = line;
  editor.scrollIntoView({ line, ch: 0 }, 90);
  editor.setCursor({ line, ch: 0 });
  editor.focus();
}

function buildInstructionLineMap(source) {
  const result = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    let code = lines[i].replace(/\/\/.*$/, "").trim();
    if (!code) continue;
    // Strip one or more leading labels (e.g. loop: PUSHIMM 1).
    while (/^[A-Za-z_.$][\w.$-]*\s*:/.test(code)) {
      code = code.replace(/^[A-Za-z_.$][\w.$-]*\s*:\s*/, "");
    }
    if (!code) continue;
    const token = code.match(/^([A-Za-z_.$][\w.$-]*)/);
    if (token && opcodes.has(token[1].toUpperCase())) result.push(i);
  }
  return result;
}

function clearExecutionHighlight() {
  if (executionLine !== null) {
    editor.removeLineClass(executionLine, "text", "sam-current-instruction-text");
    executionLine = null;
  }
  if (executionGutterLine !== null) {
    editor.setGutterMarker(executionGutterLine, "execution-gutter", null);
    executionGutterLine = null;
  }
  lastPC = -2;
}
function highlightPC(pc) {
  if (pc === lastPC) return;
  if (executionLine !== null) editor.removeLineClass(executionLine, "text", "sam-current-instruction-text");
  if (executionGutterLine !== null) editor.setGutterMarker(executionGutterLine, "execution-gutter", null);
  executionLine = null;
  executionGutterLine = null;
  lastPC = pc;
  if (!Number.isInteger(pc) || pc < 0 || pc >= instructionLines.length) {
    executionStatus.textContent = pc >= instructionLines.length && instructionLines.length ? "Completed" : "Ready";
    return;
  }
  const line = instructionLines[pc];
  const marker = document.createElement("span");
  marker.className = "execution-marker";
  marker.textContent = "▶";
  marker.title = `Next instruction (PC ${pc})`;
  editor.setGutterMarker(line, "execution-gutter", marker);
  if (editorSettings.pcHighlight) editor.addLineClass(line, "text", "sam-current-instruction-text");
  executionLine = line;
  executionGutterLine = line;
  executionStatus.textContent = `PC ${pc} · line ${line + 1}`;
  editor.scrollIntoView({ line, ch: 0 }, 60);
}

async function pollPC() {
  if (!samGui) return;
  try {
    const pc = Number(await samGui.getProgramCounter());
    highlightPC(pc);
  } catch (error) {
    console.debug("PC polling unavailable", error);
  }
}
function startPCPolling() {
  if (pcPollTimer) clearInterval(pcPollTimer);
  pcPollTimer = setInterval(pollPC, 150);
}

function parseLoadResult(result) {
  const text = String(result || "");
  if (text === "OK") return { ok: true };
  const parts = text.split("\t");
  if (parts[0] === "ERR") return { ok: false, line: Number(parts[1]) || 0, message: parts.slice(2).join("\t") || "Assembler error" };
  return { ok: false, line: 0, message: text || "Assembler error" };
}

async function ensureCurrentSourceLoaded({ quiet = false, force = false } = {}) {
  if (!samGui) throw new Error("SaM is still starting.");
  setFilenameAndPersist();
  const source = sourceText();
  if (!force && source === lastLoadedSource) return true;

  clearDiagnostics();
  clearExecutionHighlight();
  try {
    const result = parseLoadResult(await samGui.loadSourceChecked(source, currentFilename()));
    if (!result.ok) {
      showDiagnostic(result.line || 1, result.message);
      executionStatus.textContent = "Assembly error";
      if (!quiet) notify(`Assembly error: ${result.message}`, true);
      return false;
    }
    lastLoadedSource = source;
    instructionLines = buildInstructionLineMap(source);
    executionStatus.textContent = "Ready";
    await pollPC();
    if (!quiet) notify(`Assembled ${currentFilename()}.`);
    return true;
  } catch (error) {
    console.error("SaM load error", error);
    showDiagnostic(1, errorText(error));
    executionStatus.textContent = "Load error";
    if (!quiet) notify(`SaM could not load the program: ${errorText(error)}`, true);
    return false;
  }
}


async function shareActiveProgram() {
  saveActiveEditorState();
  const tab = activeTab();
  const url = new URL(window.location.href);
  url.hash = `share=${encodeSharePayload(tab)}`;
  try {
    await navigator.clipboard.writeText(url.toString());
    notify("Shareable program URL copied.");
  } catch {
    window.prompt("Copy this shareable program URL:", url.toString());
  }
}

function importSharedProgram() {
  const shared = sharedProgramFromLocation();
  if (!shared) return;
  if (shared.error) {
    notify("This shared SaM URL could not be decoded.", true);
    clearShareFragment();
    return;
  }
  createNewTab({
    filename: shared.filename,
    source: shared.source,
    dirty: true,
    selectStem: false,
  });
  clearShareFragment();
  notify(`Opened shared program ${shared.filename}.`);
}

function newFile() { createNewTab(); }
function openFilePicker() { fileInput.click(); }
document.querySelector("#newBtn").addEventListener("click", newFile);
newTabBtn.addEventListener("click", newFile);
document.querySelector("#openBtn").addEventListener("click", openFilePicker);
shareBtn.addEventListener("click", shareActiveProgram);
fileInput.addEventListener("change", async () => {
  const files = [...(fileInput.files || [])];
  for (const file of files) createNewTab({ filename: file.name || "program.sam", source: await file.text(), dirty: false, selectStem: false });
  fileInput.value = "";
  if (files.length) notify(`Opened ${files.length === 1 ? files[0].name : `${files.length} files`}.`);
});
document.querySelector("#saveBtn").addEventListener("click", downloadSource);

runBtn.addEventListener("click", async () => {
  if (await ensureCurrentSourceLoaded({ quiet: true, force: true })) {
    try { await samGui.runWeb(); executionStatus.textContent = "Running"; }
    catch (error) { console.error(error); notify(`Run failed: ${errorText(error)}`, true); }
  }
});
stepBtn.addEventListener("click", async () => {
  if (!(await ensureCurrentSourceLoaded({ quiet: true }))) return;
  try { await samGui.stepWeb(); await pollPC(); }
  catch (error) { console.error(error); notify(`Step failed: ${errorText(error)}`, true); }
});
resetBtn.addEventListener("click", async () => {
  if (!(await ensureCurrentSourceLoaded({ quiet: true }))) return;
  try { await samGui.resetWeb(); clearExecutionHighlight(); await pollPC(); notify("SaM reset."); }
  catch (error) { console.error(error); notify(`Reset failed: ${errorText(error)}`, true); }
});
stopBtn.addEventListener("click", async () => {
  try { await samGui.stopWeb(); await pollPC(); executionStatus.textContent = "Stopped"; }
  catch (error) { console.error(error); notify(`Stop failed: ${errorText(error)}`, true); }
});

document.querySelector("#diagnosticClose").addEventListener("click", clearDiagnostics);


function openHelp() {
  settingsPanel.hidden = true;
  settingsBtn.setAttribute("aria-expanded", "false");
  helpModal.hidden = false;
  showHelpOnStartInput.checked = true;
  setTimeout(() => helpDoneBtn.focus(), 0);
}
function closeHelp({ markSeen = true } = {}) {
  if (markSeen) {
    try { localStorage.setItem(HELP_SEEN_KEY, "1"); } catch {}
  }
  helpModal.hidden = true;
  editor.refresh();
}
function maybeShowFirstRunHelp() {
  let seen = false;
  try { seen = localStorage.getItem(HELP_SEEN_KEY) === "1"; } catch {}
  if (!seen) openHelp();
}
function setMobileView(view, { persist = true } = {}) {
  const normalized = view === "simulator" ? "simulator" : "editor";
  workspaceEl.dataset.mobileView = normalized;
  mobileEditorBtn.classList.toggle("active", normalized === "editor");
  mobileSimulatorBtn.classList.toggle("active", normalized === "simulator");
  mobileEditorBtn.setAttribute("aria-pressed", String(normalized === "editor"));
  mobileSimulatorBtn.setAttribute("aria-pressed", String(normalized === "simulator"));
  if (persist) { try { localStorage.setItem(MOBILE_VIEW_KEY, normalized); } catch {} }
  requestAnimationFrame(() => {
    editor.refresh();
    window.dispatchEvent(new Event("resize"));
  });
}
function restoreMobileView() {
  let saved = "editor";
  try { saved = localStorage.getItem(MOBILE_VIEW_KEY) || "editor"; } catch {}
  setMobileView(saved, { persist: false });
}

function setSetting(name, value) {
  editorSettings[name] = value;
  persistSettings(); applySettings();
  if (name === "pcHighlight" && value && executionLine !== null) {
    editor.addLineClass(executionLine, "text", "sam-current-instruction-text");
  }
}
settingsBtn.addEventListener("click", event => {
  event.stopPropagation();
  const opening = settingsPanel.hidden;
  settingsPanel.hidden = !opening;
  settingsBtn.setAttribute("aria-expanded", String(opening));
});
settingsPanel.addEventListener("click", event => event.stopPropagation());
aboutHelpBtn.addEventListener("click", openHelp);
helpCloseBtn.addEventListener("click", () => closeHelp());
helpDoneBtn.addEventListener("click", () => closeHelp());
helpModal.addEventListener("click", event => { if (event.target === helpModal) closeHelp(); });
showHelpOnStartInput.addEventListener("change", () => {
  if (!showHelpOnStartInput.checked) {
    try { localStorage.setItem(HELP_SEEN_KEY, "1"); } catch {}
  }
});
mobileEditorBtn.addEventListener("click", () => setMobileView("editor"));
mobileSimulatorBtn.addEventListener("click", () => setMobileView("simulator"));
document.addEventListener("click", () => {
  if (!settingsPanel.hidden) { settingsPanel.hidden = true; settingsBtn.setAttribute("aria-expanded", "false"); }
});
themeSelect.addEventListener("change", () => setSetting("theme", themeSelect.value));
fontSizeInput.addEventListener("input", () => { editorSettings.fontSize = Number(fontSizeInput.value); fontSizeOutput.textContent = `${editorSettings.fontSize}px`; persistSettings(); applySettings(); });
fontFamilySelect.addEventListener("change", () => setSetting("fontFamily", fontFamilySelect.value));
tabWidthSelect.addEventListener("change", () => setSetting("tabWidth", Number(tabWidthSelect.value)));
lineWrapInput.addEventListener("change", () => setSetting("lineWrapping", lineWrapInput.checked));
pcHighlightInput.addEventListener("change", () => setSetting("pcHighlight", pcHighlightInput.checked));
document.querySelector("#resetSettingsBtn").addEventListener("click", () => {
  editorSettings = { ...defaultSettings }; persistSettings(); applySettings(); notify("Editor settings reset.");
});

// Familiar desktop-editor shortcuts. Browser defaults are suppressed only for
// shortcuts the IDE actually handles.
document.addEventListener("keydown", event => {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === "s") { event.preventDefault(); downloadSource(); return; }
  if (mod && key === "o") { event.preventDefault(); openFilePicker(); return; }
  if (mod && key === "n") { event.preventDefault(); newFile(); return; }
  if (mod && key === "w") { event.preventDefault(); closeTab(); return; }
  if (mod && event.key === "Enter") { event.preventDefault(); if (!runBtn.disabled) runBtn.click(); return; }
  if (event.key === "F10") { event.preventDefault(); if (!stepBtn.disabled) stepBtn.click(); return; }
  if (event.key === "Escape" && !helpModal.hidden) { event.preventDefault(); closeHelp(); }
});

const splitter = document.querySelector("#splitter");
try {
  const savedSplit = Number(localStorage.getItem(SPLIT_KEY));
  if (savedSplit >= 25 && savedSplit <= 72) document.documentElement.style.setProperty("--editor-width", `${savedSplit}%`);
} catch {}
let dragging = false;
let splitPct = null;
splitter.addEventListener("pointerdown", (event) => {
  if (window.matchMedia("(max-width: 900px)").matches) return;
  dragging = true; splitter.setPointerCapture(event.pointerId);
});
splitter.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const pct = Math.min(72, Math.max(25, (event.clientX / window.innerWidth) * 100));
  splitPct = pct;
  document.documentElement.style.setProperty("--editor-width", `${pct}%`);
  editor.refresh();
});
splitter.addEventListener("pointerup", () => {
  dragging = false;
  if (splitPct !== null) { try { localStorage.setItem(SPLIT_KEY, String(splitPct)); } catch {} }
});
splitter.addEventListener("pointercancel", () => { dragging = false; });

async function startSaM() {
  try {
    setSimulatorControls(false);
    runtimeStatus.textContent = "CheerpJ: initializing…";
    await cheerpjInit({ version: 8 });
    runtimeStatus.textContent = "SaM: loading…";
    cheerpjCreateDisplay(-1, -1, document.querySelector("#samDisplay"));
    const lib = await cheerpjRunLibrary(SAM_CLASSPATH);
    const WebSamGUI = await lib.edu.cornell.cs.sam.ui.WebSamGUI;
    samGui = await new WebSamGUI();
    await samGui.startWeb();
    placeholder.style.display = "none";
    setSimulatorControls(true);
    runtimeStatus.textContent = "SaM: ready";
    runtimeStatus.className = "status status-ready";
    await ensureCurrentSourceLoaded({ quiet: true, force: true });
    startPCPolling();
  } catch (error) {
    console.error("Failed to start SaM", error);
    runtimeStatus.textContent = "SaM: failed to start";
    runtimeStatus.className = "status status-error";
    placeholder.style.display = "grid";
    placeholder.innerHTML = `
      <div>
        <p><strong>Could not launch SaM.</strong></p>
        <p>CheerpJ resolved the JARs as:</p>
        <p><code>${escapeHtml(SAM_BRIDGE_JAR)}</code><br><code>${escapeHtml(SAM_RUNTIME_JAR)}</code></p>
        <p>Check that those files exist at the corresponding site path and that the site is served over HTTP/HTTPS.</p>
      </div>`;
    notify(`SaM did not start: ${errorText(error)} | ${SAM_CLASSPATH}`, true);
  }
}
restoreMobileView();
importSharedProgram();
maybeShowFirstRunHelp();
startSaM();
