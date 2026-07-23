import type { OnMount } from "@monaco-editor/react";

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

function normalizeEditorEol(value: string, eol: string) {
  return value.replace(/\r\n|\r|\n/g, eol);
}

export function applyEditorValuePatch(editor: EditorInstance, monaco: MonacoInstance, nextValue: string) {
  const model = editor.getModel();
  if (!model) return false;

  const currentValue = model.getValue();
  const normalizedNextValue = normalizeEditorEol(nextValue, model.getEOL());
  if (currentValue === normalizedNextValue) return false;

  let start = 0;
  const sharedLength = Math.min(currentValue.length, normalizedNextValue.length);
  while (start < sharedLength && currentValue.charCodeAt(start) === normalizedNextValue.charCodeAt(start)) start += 1;

  let currentEnd = currentValue.length;
  let nextEnd = normalizedNextValue.length;
  while (currentEnd > start && nextEnd > start && currentValue.charCodeAt(currentEnd - 1) === normalizedNextValue.charCodeAt(nextEnd - 1)) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  const from = model.getPositionAt(start);
  const to = model.getPositionAt(currentEnd);
  editor.executeEdits("pairboard.remote", [{
    range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
    text: normalizedNextValue.slice(start, nextEnd),
    forceMoveMarkers: false,
  }]);
  return true;
}
