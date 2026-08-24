const SAM_CLASSPATH = "/app/jar/sam-web-bridge.jar:/app/jar/SaM-2.6.3.jar";
const AUTOSAVE_KEY = "sam-web-ide-source-v10";
const FILENAME_KEY = "sam-web-ide-filename-v1";

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
function savedFilename() {
  try { return normalizeFilename(localStorage.getItem(FILENAME_KEY) || "untitled.sam"); }
  catch { return "untitled.sam"; }
}
function setFilename(name, { selectStem = false } = {}) {
  filenameInput.value = normalizeFilename(name);
  try { localStorage.setItem(FILENAME_KEY, filenameInput.value); } catch {}
  if (selectStem) {
    const end = Math.max(0, filenameInput.value.toLowerCase().lastIndexOf(".sam"));
    filenameInput.focus();
    filenameInput.setSelectionRange(0, end || filenameInput.value.length);
  }
}
filenameInput.value = savedFilename();

function savedSource() {
  try {
    return localStorage.getItem(AUTOSAVE_KEY)
      || localStorage.getItem("sam-web-ide-source-v9")
      || localStorage.getItem("sam-web-ide-source-v8")
      || localStorage.getItem("sam-web-ide-source-v7")
      || localStorage.getItem("sam-web-ide-source-v6")
      || localStorage.getItem("sam-web-ide-source-v5")
      || starterProgram;
  } catch { return starterProgram; }
}

const editor = CodeMirror(document.querySelector("#editor"), {
  value: savedSource(), mode: "sam", theme: "samweb", lineNumbers: true,
  gutters: ["CodeMirror-linenumbers", "execution-gutter", "diagnostics-gutter"],
  lineWrapping: true, styleActiveLine: true, matchBrackets: true,
  autoCloseBrackets: true, indentUnit: 2, tabSize: 2, indentWithTabs: false,
  cursorBlinkRate: 530,
});
editor.setSize("100%", "100%");


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
  executionStatus.textContent = lastLoadedSource === editor.getValue() ? "Loaded" : "Modified";
}
editor.on("change", (_cm, change) => {
  try { localStorage.setItem(AUTOSAVE_KEY, editor.getValue()); } catch {}
  updateCursorStatus();
  markDirty();
  updateCompletionsAfterEdit(change);
});
editor.on("cursorActivity", updateCursorStatus);
updateCursorStatus();

function setEditorText(text) { editor.setValue(text); editor.focus(); }
function sourceText() { return editor.getValue(); }
function currentFilename() { return normalizeFilename(filenameInput.value); }

function notify(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function setFilenameAndPersist() { setFilename(filenameInput.value); }
filenameInput.addEventListener("input", () => {
  try { localStorage.setItem(FILENAME_KEY, filenameInput.value); } catch {}
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
  editor.addLineClass(line, "text", "sam-current-instruction-text");
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

document.querySelector("#newBtn").addEventListener("click", () => {
  setFilename("untitled.sam", { selectStem: true });
  lastLoadedSource = null;
  setEditorText(starterProgram);
});
document.querySelector("#openBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0]; if (!file) return;
  setFilename(file.name || "program.sam"); lastLoadedSource = null; setEditorText(await file.text());
  fileInput.value = ""; notify(`Opened ${currentFilename()}`);
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

const splitter = document.querySelector("#splitter");
let dragging = false;
splitter.addEventListener("pointerdown", (event) => {
  if (window.matchMedia("(max-width: 900px)").matches) return;
  dragging = true; splitter.setPointerCapture(event.pointerId);
});
splitter.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const pct = Math.min(72, Math.max(25, (event.clientX / window.innerWidth) * 100));
  document.documentElement.style.setProperty("--editor-width", `${pct}%`);
});
splitter.addEventListener("pointerup", () => { dragging = false; });
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
    placeholder.innerHTML = `<p><strong>Could not launch SaM.</strong></p><p>Check that both JARs exist under <code>jar/</code> and that the site is served over HTTP.</p>`;
    notify(`SaM did not start: ${errorText(error)}`, true);
  }
}
startSaM();
