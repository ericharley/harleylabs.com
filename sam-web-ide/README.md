# SaM Web IDE

A browser-hosted teaching IDE for **SaM (Stack Machine) 2.6.3**. The original SaM Swing application runs under CheerpJ and is paired with a browser-native CodeMirror editor.

## Run it

No Java build is needed just to run the checked-in prototype:

```bash
./scripts/serve.sh
```

Then open <http://localhost:8080>.

The package includes:

- the original `jar/SaM-2.6.3.jar` unchanged;
- a precompiled `jar/sam-web-bridge.jar`;
- bridge source under `bridge-src/`;
- a locally vendored CodeMirror 5 editor (no CodeMirror CDN dependency).

CheerpJ itself is still loaded from Leaning Technologies at runtime.

## Rebuild the Java bridge

If you edit `bridge-src/edu/cornell/cs/sam/ui/WebSamGUI.java`, rebuild with:

```bash
./scripts/build-bridge.sh
```

The script compiles against the bundled SaM JAR and replaces `jar/sam-web-bridge.jar`.

Requirements:

- a JDK with `javac` and `jar` on `PATH`;
- Java 8-compatible source/bytecode is used for the bridge.

## Editor workspace

The browser editor now supports multiple `.sam` files as tabs. **New** or the `+` tab button creates a new buffer, **Open** can open one or several `.sam` files as new tabs, and **Download** downloads the active tab. Each tab stores its own filename, source text, cursor position, scroll position, and dirty state. The complete workspace is restored from browser `localStorage` after a refresh.

The browser toolbar remains the primary execution workflow:

- **Run** always assembles/reloads the active tab before running it;
- **Step** automatically reloads first if that tab's source changed;
- **Reset** likewise uses the active buffer;
- **Stop** stops the running SaM program.

The filename field in the upper-right renames the active tab and controls both the downloaded filename and the name shown to SaM. Closing a dirty tab asks before discarding changes that have not been downloaded. Existing single-buffer autosaves from earlier prototype versions are migrated into the first v13 tab.

### Editor settings

The gear menu stores editor preferences locally and supports:

- Dark, Light, and High Contrast themes;
- font sizes from 11–24 px;
- several monospace font stacks;
- tab widths of 2, 4, or 8 spaces;
- line wrapping on/off;
- current-PC source highlighting on/off.

The editor/simulator split position is also remembered. Theme changes apply to the browser IDE; the original SaM Swing simulator retains its native appearance.

### Keyboard shortcuts

- **Ctrl/Cmd+N** — new tab
- **Ctrl/Cmd+O** — open file(s)
- **Ctrl/Cmd+S** — download active tab
- **Ctrl/Cmd+W** — close active tab
- **Ctrl/Cmd+Enter** — run active tab
- **F10** — step
- **Ctrl/Cmd+Space** — autocomplete

### Assembly diagnostics

SaM's own `AssemblerException.getLine()` is surfaced through the bridge. When assembly fails, the IDE:

- shows the exact SaM error beneath the editor;
- marks the assembler-reported source line;
- adds an error marker in the editor gutter;
- scrolls the editor to the offending line.

### Execution-line synchronization

The bridge exposes SaM's actual `Processor.PC` register. The browser polls that value while SaM is active and highlights the source line corresponding to the next instruction.

The source-to-PC mapping intentionally stays outside the SaM JAR. It maps each assembled instruction to the source line containing an opcode, ignoring blank lines, comments, and labels. This is accurate for normal one-instruction-per-line SaM source. If we later need exact mappings for unusual syntax, the bridge can be extended to capture assembler/tokenizer source locations directly.


## Autocomplete

The editor includes SaM-specific autocomplete for all known ISA opcodes and labels defined in the current source file. Instruction suggestions show the operand signature (for example `PUSHIMM int`, `JUMPC label`, or `PUSHIMMSTR string`) plus a short operand description. Choosing an instruction that takes an operand inserts the opcode followed by a space, ready for the argument. In label/address operand positions, autocomplete narrows to labels defined in the current source file. Suggestions appear automatically after typing two characters. You can also press **Ctrl-Space** (or **Cmd-Space**) to request suggestions explicitly. Use Up/Down to select and Enter or Tab to insert.

Autocomplete is implemented locally in `app.js`; it does not add another CDN or CodeMirror plugin dependency.

## CodeMirror

CodeMirror is vendored under:

```text
vendor/codemirror/
```

The checked-in version is **5.58.3**, including the core editor plus only the three addons this IDE uses:

- active-line highlighting;
- bracket matching;
- automatic closing brackets.

This avoids an additional classroom-day CDN dependency. The vendored CodeMirror source files retain their upstream MIT-license header.

The optional `scripts/vendor-codemirror.sh` script can fetch CodeMirror 5.65.16 on a machine with internet access if you want to refresh the vendored files. After doing so, update the paths/version notes as appropriate.

## Project layout

```text
sam-web-ide/
├── index.html
├── app.js
├── styles.css
├── README.md
├── bridge-src/
│   └── edu/cornell/cs/sam/ui/WebSamGUI.java
├── jar/
│   ├── SaM-2.6.3.jar
│   └── sam-web-bridge.jar
├── scripts/
│   ├── build-bridge.sh
│   ├── serve.sh
│   └── vendor-codemirror.sh
└── vendor/
    └── codemirror/
```

## Architecture

```text
CodeMirror source
      |
      | JavaScript string
      v
WebSamGUI.loadSourceChecked(...)
      |
      v
SamAssembler.assemble(...)
      |
      v
Original SamGUI / VM
      |
      +---- Processor.PC ----> editor execution highlight
```

The original SaM JAR remains untouched.


## Breakpoints

Breakpoints are intentionally managed only through the original SaM Swing UI. The browser editor does not mirror or modify SaM breakpoints; this keeps breakpoint semantics identical to the desktop simulator.



### Autocomplete behavior

Autocomplete is driven by editor text changes rather than raw keyboard events, so typing uppercase instructions with Shift does not dismiss the suggestion list. Type two or more characters or press `Ctrl-Space` / `Cmd-Space`; use Up/Down and Enter/Tab to choose a completion.

## Hosting from a subdirectory / GitHub Pages

The CheerpJ JAR classpath is derived from `window.location.pathname`, so the same build works both at the web root and beneath a deployment prefix.

Examples:

- `http://localhost:8080/` resolves the JARs under `/app/jar/`;
- `https://example.com/sam-web-ide/` resolves them under `/app/sam-web-ide/jar/`.

No hard-coded GitHub Pages repository name is required. If SaM fails to start, the simulator pane now shows the exact CheerpJ JAR paths it attempted to load.

## v14 help and mobile layout

On first use, the IDE presents a short help dialog describing the editor, simulator, autocomplete, files, and keyboard shortcuts. It can be reopened at any time from **Settings (gear) → About / Help**.

On screens 900px wide or narrower, the desktop split view changes to a mobile workspace switcher with **Editor** and **Simulator** views. The selected mobile view is remembered locally. This avoids squeezing the Swing simulator and CodeMirror into two unusably narrow panes on phones and tablets.


## Shareable program URLs

Use **Share** in the editor toolbar to copy a URL containing the active `.sam`
program and its filename. The program is encoded in the URL fragment (`#share=...`),
so opening the link creates a new editor tab without requiring a backend or server-side
storage. After import, the share fragment is removed from the address bar to avoid
accidentally re-importing the program on refresh.

Because the full source is carried in the URL, this is intended for normal small SaM
examples and teaching exercises rather than very large files.


## ISA documentation

v16 uses one canonical in-browser metadata database for all SaM 2.6.3 opcodes.
That database drives syntax recognition, autocomplete signatures/descriptions, hover
documentation, and the searchable **Settings → ISA Reference** dialog. The reference
can be searched by opcode, category, operand/signature, or descriptive text.

Autocomplete is enabled by default and can be disabled with **Settings → Autocomplete**.
The preference is saved with the other editor settings.
