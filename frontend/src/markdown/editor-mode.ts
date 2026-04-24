import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/core";
import { $prose } from "@milkdown/utils";
import { Plugin, Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { nord } from "@milkdown/theme-nord";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { history } from "@milkdown/plugin-history";
import type { WebSocketClient } from "../platform/websocket";

export type EditorMode = "view" | "normal" | "edit";

export interface EditorCallbacks {
  getCurrentContent: () => string;
  getCurrentPath: () => string | null;
  getCurrentFileType: () => string;
  setCurrentContent: (content: string) => void;
  getContainer: () => HTMLElement;
  onRender: () => void;
}

export interface EditorModeState {
  mode: EditorMode;
  isDirty: boolean;
  editor: Editor | null;
  editorContainer: HTMLElement | null;
  editorContent: string;
  lastGPressNormal: number;
}

export function createEditorModeState(): EditorModeState {
  return {
    mode: "view",
    isDirty: false,
    editor: null,
    editorContainer: null,
    editorContent: "",
    lastGPressNormal: 0,
  };
}

/**
 * Get the ProseMirror editor view from Milkdown.
 */
export function getEditorView(state: EditorModeState): EditorView | null {
  if (!state.editor) return null;
  try {
    return state.editor.ctx.get(editorViewCtx);
  } catch {
    return null;
  }
}

// --- Cursor movement (pure ProseMirror operations) ---

export function moveCursorLeft(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  if ($from.pos > 0) {
    const $pos = state.doc.resolve($from.pos - 1);
    const sel = Selection.near($pos, -1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }
}

export function moveCursorRight(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  if ($from.pos < state.doc.content.size) {
    const $pos = state.doc.resolve($from.pos + 1);
    const sel = Selection.near($pos, 1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }
}

export function moveCursorDown(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const blockEnd = $from.end();
  if (blockEnd + 1 < state.doc.content.size) {
    const $nextPos = state.doc.resolve(blockEnd + 1);
    const sel = Selection.near($nextPos, 1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }
}

export function moveCursorUp(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const blockStart = $from.start();
  if (blockStart > 1) {
    const $prevPos = state.doc.resolve(blockStart - 1);
    const sel = Selection.near($prevPos, -1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }
}

export function moveCursorWordForward(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const text = state.doc.textBetween($from.pos, state.doc.content.size, "\n", "\ufffc");
  const match = text.match(/^\S*\s*/);
  if (match && match[0].length > 0) {
    const targetPos = Math.min($from.pos + match[0].length, state.doc.content.size);
    const $pos = state.doc.resolve(targetPos);
    const sel = Selection.near($pos, 1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }
}

export function moveCursorWordBackward(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const text = state.doc.textBetween(0, $from.pos, "\n", "\ufffc");
  const match = text.match(/\s*\S+\s*$/);
  if (match) {
    const targetPos = Math.max(0, $from.pos - match[0].length);
    const $pos = state.doc.resolve(targetPos);
    const sel = Selection.near($pos, -1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  } else {
    const $pos = state.doc.resolve(0);
    const sel = Selection.near($pos, 1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }
}

export function moveCursorWordEnd(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const text = state.doc.textBetween($from.pos, state.doc.content.size, "\n", "\ufffc");
  const match = text.match(/^\s*\S*/);
  if (match && match[0].length > 0) {
    const targetPos = Math.min($from.pos + match[0].length, state.doc.content.size);
    const $pos = state.doc.resolve(targetPos);
    const sel = Selection.near($pos, 1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }
}

export function moveCursorLineStart(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const start = $from.start();
  dispatch(state.tr.setSelection(TextSelection.create(state.doc, start)).scrollIntoView());
}

export function moveCursorLineEnd(view: EditorView): void {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  const end = $from.end();
  dispatch(state.tr.setSelection(TextSelection.create(state.doc, end)).scrollIntoView());
}

export function moveCursorDocumentStart(view: EditorView): void {
  const { state, dispatch } = view;
  const $pos = state.doc.resolve(0);
  const sel = Selection.near($pos, 1);
  dispatch(state.tr.setSelection(sel).scrollIntoView());
}

export function moveCursorDocumentEnd(view: EditorView): void {
  const { state, dispatch } = view;
  const $pos = state.doc.resolve(state.doc.content.size);
  const sel = Selection.near($pos, -1);
  dispatch(state.tr.setSelection(sel).scrollIntoView());
}

// --- Normal mode key handlers ---

/**
 * Handle 'g' key for double-tap gg detection in normal mode.
 */
function handleNormalModeGKey(view: EditorView, state: EditorModeState): boolean {
  const now = Date.now();
  if (now - state.lastGPressNormal < 500) {
    moveCursorDocumentStart(view);
    state.lastGPressNormal = 0;
    return true;
  }
  state.lastGPressNormal = now;
  return true;
}

/**
 * Handle normal mode vim navigation keys.
 * Returns true if the key was handled.
 */
export function handleNormalModeKey(
  e: KeyboardEvent,
  editorState: EditorModeState,
  enterEditFromNormal: () => void,
  save: () => void,
  exitToView: () => void
): boolean {
  const view = getEditorView(editorState);
  if (!view) return false;

  const key = e.key;

  // Ctrl+s saves
  if (key === "s" && e.ctrlKey) {
    e.preventDefault();
    save();
    return true;
  }

  // ESC exits to View mode
  if (key === "Escape") {
    e.preventDefault();
    exitToView();
    return true;
  }

  // 'i' enters Edit mode (like Vim insert mode)
  if (key === "i" && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    enterEditFromNormal();
    return true;
  }

  // Ctrl+i also enters Edit mode
  if (e.ctrlKey && key === "i") {
    e.preventDefault();
    enterEditFromNormal();
    return true;
  }

  // Cursor movement
  switch (key) {
    case "h":
    case "ArrowLeft":
      e.preventDefault();
      moveCursorLeft(view);
      return true;
    case "j":
    case "ArrowDown":
      e.preventDefault();
      moveCursorDown(view);
      return true;
    case "k":
    case "ArrowUp":
      e.preventDefault();
      moveCursorUp(view);
      return true;
    case "l":
    case "ArrowRight":
      e.preventDefault();
      moveCursorRight(view);
      return true;
    case "w":
      e.preventDefault();
      moveCursorWordForward(view);
      return true;
    case "b":
      e.preventDefault();
      moveCursorWordBackward(view);
      return true;
    case "e":
      e.preventDefault();
      moveCursorWordEnd(view);
      return true;
    case "0":
      e.preventDefault();
      moveCursorLineStart(view);
      return true;
    case "$":
      e.preventDefault();
      moveCursorLineEnd(view);
      return true;
    case "G":
      e.preventDefault();
      moveCursorDocumentEnd(view);
      return true;
    case "g":
      e.preventDefault();
      return handleNormalModeGKey(view, editorState);
  }

  // Block all other printable characters in normal mode
  if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    return true;
  }

  return false;
}

// --- ProseMirror vim plugin ---

/**
 * Create a ProseMirror plugin to handle vim keys directly within the editor.
 * This bypasses the keybinding manager's contenteditable detection.
 */
export function createVimModePlugin(
  getMode: () => EditorMode,
  enterEditFromNormal: () => void,
  enterNormalFromEdit: () => void,
  exitToView: () => void,
  save: () => void,
  editorState: EditorModeState
): Plugin {
  return new Plugin({
    props: {
      handleKeyDown: (view, event) => {
        if (getMode() === "normal") {
          return handleNormalModeKeyProseMirror(
            view, event, editorState, enterEditFromNormal, save, exitToView
          );
        }
        // Edit mode - only intercept Ctrl+i and Esc
        if (event.ctrlKey && event.key === "i") {
          event.preventDefault();
          enterNormalFromEdit();
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          exitToView();
          return true;
        }
        return false;
      },
      handleTextInput: () => {
        return getMode() === "normal";
      },
    },
  });
}

/**
 * Handle normal mode keys from within ProseMirror plugin.
 */
function handleNormalModeKeyProseMirror(
  view: EditorView,
  e: KeyboardEvent,
  editorState: EditorModeState,
  enterEditFromNormal: () => void,
  save: () => void,
  exitToView: () => void
): boolean {
  const key = e.key;

  if (key === "s" && e.ctrlKey) {
    e.preventDefault();
    save();
    return true;
  }

  if (key === "Escape") {
    e.preventDefault();
    exitToView();
    return true;
  }

  // 'i' or Ctrl+i enters Edit mode
  if (key === "i" && !e.altKey && !e.metaKey) {
    e.preventDefault();
    enterEditFromNormal();
    return true;
  }

  switch (key) {
    case "h":
    case "ArrowLeft":
      e.preventDefault();
      moveCursorLeft(view);
      return true;
    case "j":
    case "ArrowDown":
      e.preventDefault();
      moveCursorDown(view);
      return true;
    case "k":
    case "ArrowUp":
      e.preventDefault();
      moveCursorUp(view);
      return true;
    case "l":
    case "ArrowRight":
      e.preventDefault();
      moveCursorRight(view);
      return true;
    case "w":
      e.preventDefault();
      moveCursorWordForward(view);
      return true;
    case "b":
      e.preventDefault();
      moveCursorWordBackward(view);
      return true;
    case "e":
      e.preventDefault();
      moveCursorWordEnd(view);
      return true;
    case "0":
      e.preventDefault();
      moveCursorLineStart(view);
      return true;
    case "$":
      e.preventDefault();
      moveCursorLineEnd(view);
      return true;
    case "G":
      e.preventDefault();
      moveCursorDocumentEnd(view);
      return true;
    case "g":
      e.preventDefault();
      return handleNormalModeGKey(view, editorState);
  }

  if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    return true;
  }

  return false;
}

// --- Mode transitions ---

/**
 * Enter Normal mode from View mode (opens Milkdown editor in navigation mode).
 */
export async function enterNormalMode(
  editorState: EditorModeState,
  callbacks: EditorCallbacks,
  ws: WebSocketClient
): Promise<void> {
  if (editorState.mode !== "view" || callbacks.getCurrentPath() === null) return;
  if (callbacks.getCurrentFileType() !== "markdown") return;

  editorState.mode = "normal";
  editorState.isDirty = false;
  editorState.editorContent = callbacks.getCurrentContent();

  const container = callbacks.getContainer();
  const currentPath = callbacks.getCurrentPath()!;

  const header = document.createElement("div");
  header.className = "viewer-header normal-mode";

  const headerLeft = document.createElement("div");
  headerLeft.className = "viewer-header-left";
  const dirtyIndicator = document.createElement("span");
  dirtyIndicator.className = "viewer-dirty-indicator";
  dirtyIndicator.textContent = "[+]";
  dirtyIndicator.style.display = "none";
  headerLeft.appendChild(dirtyIndicator);
  header.appendChild(headerLeft);

  const filename = document.createElement("span");
  filename.className = "viewer-filename";
  const displayName = currentPath.split("/").pop() ?? currentPath;
  filename.textContent = displayName;
  header.appendChild(filename);

  const headerRight = document.createElement("div");
  headerRight.className = "viewer-header-right";
  const modeIndicator = document.createElement("span");
  modeIndicator.className = "mode-indicator mode-normal";
  modeIndicator.textContent = "[NORMAL]";
  headerRight.appendChild(modeIndicator);
  header.appendChild(headerRight);

  editorState.editorContainer = document.createElement("div");
  editorState.editorContainer.className = "milkdown-editor mode-normal";
  editorState.editorContainer.id = "milkdown-editor";

  container.innerHTML = "";
  container.appendChild(header);
  container.appendChild(editorState.editorContainer);

  // Closures for vim plugin callbacks
  const enterEditFromNormal = () => enterEditModeFromNormal(editorState, container);
  const enterNormalFromEdit = () => enterNormalModeFromEdit(editorState, container);
  const exitToView = () => doExitToView(editorState, callbacks, ws);
  const save = () => doSave(editorState, callbacks, ws);

  try {
    editorState.editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, editorState.editorContainer!);
        ctx.set(defaultValueCtx, callbacks.getCurrentContent());

        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          editorState.editorContent = markdown;
          const wasDirty = editorState.isDirty;
          editorState.isDirty = markdown !== callbacks.getCurrentContent();

          if (editorState.isDirty !== wasDirty) {
            const indicator = container.querySelector(".viewer-dirty-indicator") as HTMLElement;
            if (indicator) {
              indicator.style.display = editorState.isDirty ? "inline" : "none";
            }
          }
        });
      })
      .config(nord)
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use($prose(() => createVimModePlugin(
        () => editorState.mode,
        enterEditFromNormal,
        enterNormalFromEdit,
        exitToView,
        save,
        editorState
      )))
      .create();

    requestAnimationFrame(() => {
      const editableEl = editorState.editorContainer?.querySelector(".milkdown")?.querySelector("[contenteditable]") as HTMLElement;
      if (editableEl) {
        editableEl.focus();
        setupNormalModeInputBlock(editableEl, editorState);
      }
    });
  } catch (error) {
    console.error("Failed to create Milkdown editor:", error);
    editorState.mode = "view";
    callbacks.onRender();
  }
}

/**
 * Setup input blocking for Normal mode.
 */
function setupNormalModeInputBlock(element: HTMLElement, editorState: EditorModeState): void {
  const handler = (e: InputEvent) => {
    if (editorState.mode === "normal") {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  element.addEventListener("beforeinput", handler as EventListener);
}

/**
 * Switch from Normal mode to Edit mode.
 */
export function enterEditModeFromNormal(editorState: EditorModeState, container: HTMLElement): void {
  if (editorState.mode !== "normal") return;

  editorState.mode = "edit";

  const header = container.querySelector(".viewer-header");
  if (header) {
    header.classList.remove("normal-mode");
    header.classList.add("edit-mode");
  }

  const indicator = container.querySelector(".mode-indicator");
  if (indicator) {
    indicator.textContent = "[EDIT]";
    indicator.classList.remove("mode-normal");
    indicator.classList.add("mode-edit");
  }

  if (editorState.editorContainer) {
    editorState.editorContainer.classList.remove("mode-normal");
    editorState.editorContainer.classList.add("mode-edit");
  }
}

/**
 * Switch from Edit mode back to Normal mode.
 */
export function enterNormalModeFromEdit(editorState: EditorModeState, container: HTMLElement): void {
  if (editorState.mode !== "edit") return;

  editorState.mode = "normal";

  const header = container.querySelector(".viewer-header");
  if (header) {
    header.classList.remove("edit-mode");
    header.classList.add("normal-mode");
  }

  const indicator = container.querySelector(".mode-indicator");
  if (indicator) {
    indicator.textContent = "[NORMAL]";
    indicator.classList.remove("mode-edit");
    indicator.classList.add("mode-normal");
  }

  if (editorState.editorContainer) {
    editorState.editorContainer.classList.remove("mode-edit");
    editorState.editorContainer.classList.add("mode-normal");
  }
}

/**
 * Exit to View mode from Normal or Edit mode.
 */
export async function doExitToView(
  editorState: EditorModeState,
  callbacks: EditorCallbacks,
  ws: WebSocketClient
): Promise<void> {
  if (editorState.mode === "view") return;

  if (editorState.isDirty) {
    const shouldSave = confirm("You have unsaved changes. Save before exiting? (OK = Save, Cancel = Discard)");
    if (shouldSave) {
      await doSave(editorState, callbacks, ws);
    }
  }

  if (editorState.editor) {
    editorState.editor.destroy();
    editorState.editor = null;
  }
  editorState.editorContainer = null;

  editorState.mode = "view";
  editorState.isDirty = false;
  callbacks.onRender();
}

/**
 * Save the current editor content.
 */
export async function doSave(
  editorState: EditorModeState,
  callbacks: EditorCallbacks,
  ws: WebSocketClient
): Promise<void> {
  if ((editorState.mode !== "edit" && editorState.mode !== "normal") ||
      !editorState.editor || !callbacks.getCurrentPath()) {
    return;
  }

  try {
    const markdown = editorState.editorContent || callbacks.getCurrentContent();
    await ws.writeFile(callbacks.getCurrentPath()!, markdown);

    callbacks.setCurrentContent(markdown);
    editorState.isDirty = false;

    const indicator = callbacks.getContainer().querySelector(".viewer-dirty-indicator") as HTMLElement;
    if (indicator) {
      indicator.style.display = "none";
    }

    console.log("File saved successfully");
  } catch (error) {
    console.error("Failed to save file:", error);
    alert(`Failed to save file: ${error}`);
  }
}

/**
 * Destroy the editor and clean up resources.
 */
export function destroyEditor(editorState: EditorModeState): void {
  if (editorState.editor) {
    editorState.editor.destroy();
    editorState.editor = null;
  }
  editorState.editorContainer = null;
}
