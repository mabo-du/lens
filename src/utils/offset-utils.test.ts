/**
 * ProseMirror offset-bridge round-trip test.
 *
 * Per LENS_Implementation_Plan.md Part 5: "take a known string, create a
 * ProseMirror document from it, select a substring by known char offsets,
 * and verify the reconstructed substring is identical."
 *
 * Schema: doc > paragraph > text
 * ProseMirror position model:
 *   0 = before doc
 *   1 = before first text character  (i.e., char offset 0)
 *   2 = after first text character   (i.e., char offset 1)
 * Therefore: pm_pos = char_offset + 1, char_offset = pm_pos - 1
 *
 * Verified via TextSelection.create() round-trip: the formula MUST
 * use +1/−1, not +2/−2. With +2, the first character is silently
 * skipped (selection[0:5] returns "ello " not "Hello").
 */

import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { charOffsetToPmPos, pmPosToCharOffset } from './offset-utils';

const plainTextSchema = new Schema({
  nodes: {
    doc:       { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text:      {},
  },
  marks: {},
});

/** Build an EditorState from plain text. */
function stateFromText(text: string): EditorState {
  const docNode = plainTextSchema.node('doc', null, [
    plainTextSchema.node('paragraph', null,
      text ? [plainTextSchema.text(text)] : []
    ),
  ]);
  return EditorState.create({ doc: docNode });
}

/** Create a TextSelection from char offsets and return [selectedText, pmFrom, pmTo]. */
function selectText(
  state: EditorState,
  startChar: number,
  endChar: number,
): [string, number, number] {
  const pmFrom = charOffsetToPmPos(startChar);
  const pmTo = charOffsetToPmPos(endChar);

  const tr = state.tr;
  tr.setSelection(TextSelection.create(state.doc, pmFrom, pmTo));
  const newState = state.apply(tr);

  // Verify the selection's PM positions round-trip back to the correct
  // char offsets (this is how DocumentEditor.tsx captures selections).
  expect(pmPosToCharOffset(newState.selection.from)).toBe(startChar);
  expect(pmPosToCharOffset(newState.selection.to)).toBe(endChar);

  // Extract selected text via slice.
  const slice = newState.doc.slice(newState.selection.from, newState.selection.to);
  const text = slice.content.firstChild?.textContent ?? '';

  return [text, pmFrom, pmTo];
}

describe('offset-utils bridge', () => {
  const asciiText = 'Hello world. This is a sentence with many words.';

  // ── Mathematical invariants (no PM required) ──

  it('charOffsetToPmPos(0) maps to start of text content (position 1)', () => {
    expect(charOffsetToPmPos(0)).toBe(1);
  });

  it('charOffsetToPmPos maps successive offsets correctly', () => {
    expect(charOffsetToPmPos(0)).toBe(1);
    expect(charOffsetToPmPos(1)).toBe(2);
    expect(charOffsetToPmPos(5)).toBe(6);
    expect(charOffsetToPmPos(10)).toBe(11);
  });

  it('pmPosToCharOffset is the inverse of charOffsetToPmPos', () => {
    for (const offset of [0, 1, 5, 10, 50, 100, 1000, 99999]) {
      expect(pmPosToCharOffset(charOffsetToPmPos(offset))).toBe(offset);
    }
  });

  it('pmPosToCharOffset clamps negative positions to 0', () => {
    expect(pmPosToCharOffset(-1)).toBe(0);
    expect(pmPosToCharOffset(-999)).toBe(0);
  });

  it('pmPosToCharOffset returns 0 for position 0 (before doc)', () => {
    expect(pmPosToCharOffset(0)).toBe(0);
  });

  it('pmPosToCharOffset maps positions correctly', () => {
    expect(pmPosToCharOffset(1)).toBe(0);   // first character
    expect(pmPosToCharOffset(2)).toBe(1);   // second character
    expect(pmPosToCharOffset(6)).toBe(5);
    expect(pmPosToCharOffset(11)).toBe(10);
  });

  // ── Round-trip via TextSelection (per Plan §Part 5) ──

  it('reconstructs ASCII prefix substring via TextSelection', () => {
    const state = stateFromText(asciiText);
    const [text] = selectText(state, 0, 5);
    expect(text).toBe('Hello');
  });

  it('reconstructs ASCII middle substring via TextSelection', () => {
    const state = stateFromText(asciiText);
    const [text] = selectText(state, 6, 11);
    expect(text).toBe('world');
  });

  it('reconstructs ASCII suffix substring via TextSelection', () => {
    const state = stateFromText(asciiText);
    // 'a sentence' starts at index 21, length 10
    const start = asciiText.indexOf('a sentence');
    const end = start + 'a sentence'.length;
    const [text] = selectText(state, start, end);
    expect(text).toBe('a sentence');
  });

  it('reconstructs full ASCII text via TextSelection', () => {
    const state = stateFromText(asciiText);
    const [text] = selectText(state, 0, asciiText.length);
    expect(text).toBe(asciiText);
  });

  it('reconstructs empty selection via TextSelection', () => {
    const state = stateFromText(asciiText);
    const [text] = selectText(state, 10, 10);
    expect(text).toBe('');
  });

  it('reconstructs non-Latin text (Japanese) via TextSelection', () => {
    const japanese = '日本語のテスト文です。これは複数バイト文字を含みます。';
    const state = stateFromText(japanese);
    const [text] = selectText(state, 0, 4);
    expect(text).toBe('日本語の');
  });

  it('reconstructs non-Latin text (Arabic) via TextSelection', () => {
    const arabic = 'مرحبا بالعالم. هذا نص تجريبي.';
    const state = stateFromText(arabic);
    const [text] = selectText(state, 0, 6);
    expect(text).toBe('مرحبا ');
  });

  it('reconstructs mixed ASCII + non-Latin via TextSelection', () => {
    const mixed = 'English 日本語 العربية mixed text.';
    const state = stateFromText(mixed);
    // 'English 日本語 العربية' before ' mixed text'
    const end = mixed.indexOf(' mixed text');
    const [text] = selectText(state, 0, end);
    expect(text).toBe('English 日本語 العربية');
  });

  // ── Integration: exhaustive window sweep via TextSelection ──

  it('TextSelection round-trip matches expected substring for all windows', () => {
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const state = stateFromText(text);

    for (let start = 0; start < 10; start++) {
      for (let end = start + 1; end <= Math.min(start + 10, text.length); end++) {
        const [selected] = selectText(state, start, end);
        const expected = text.slice(start, end);
        expect(selected).toBe(expected);
      }
    }
  });
});
