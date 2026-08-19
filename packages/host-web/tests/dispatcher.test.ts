import { describe, expect, it, vi } from "vite-plus/test";
import { createEditor } from "@teamgaga/richtext-core";
import fixtures from "@teamgaga/richtext-protocol/fixtures/v2.json";
import {
  parseProtocolCommand,
  parseProtocolMessage,
  PROTOCOL_VERSION,
  type EditorCommandMessage,
} from "@teamgaga/richtext-protocol";
import { MockEditorAdapter } from "@teamgaga/richtext-testing";
import { dispatchEditorCommand } from "../src/dispatcher/command-dispatcher";

function getFixtureCommands(): EditorCommandMessage[] {
  return fixtures.commands.map((input) => {
    const parsed = parseProtocolCommand(input);

    if (!parsed.ok) {
      throw new Error(`Invalid command fixture: ${parsed.error.message}`);
    }

    return parsed.value;
  });
}

describe("Protocol to Core command dispatcher", () => {
  it("maps every Protocol v2 command and returns valid correlated responses", () => {
    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    editor.mount();
    const openLinkForm = vi.fn();

    const responses = getFixtureCommands().map((command) => {
      const response = dispatchEditorCommand(editor, command, { openLinkForm });
      expect(response.id).toBe(command.id);
      expect(parseProtocolMessage(response).ok).toBe(true);
      return response;
    });

    expect(openLinkForm).toHaveBeenCalled();
    expect(responses.every((response) => response.ok)).toBe(true);
    expect(editor.getSnapshot()).toEqual({ content: [{ insert: "hello\n" }] });
    expect(
      responses.find((response) => response.ok && response.type === "get_selection"),
    ).toMatchObject({ value: { selection: { start: 0, end: 5 } } });
    expect(editor.getSelection()).toBeNull();
    expect(adapter.commands).toEqual([
      { type: "toggle-inline-format", format: "bold" },
      { type: "toggle-block-format", format: "header", value: 2 },
      { type: "toggle-block-format", format: "list", value: "bullet" },
      { type: "toggle-block-format", format: "blockquote" },
      { type: "insert-emoji", id: "party_parrot" },
      {
        type: "insert-mention",
        mention: { id: "user-42", sign: "!", displayText: "Alice" },
        selection: { start: 0, end: 0 },
      },
      { type: "insert-channel", channel: { id: "channel-7", displayText: "general" } },
      {
        type: "insert-image",
        image: {
          src: "tgg-local-media://image-token-123",
          width: "640",
          height: "480",
          mimeType: "image/png",
          fileSize: 102400,
        },
      },
      {
        type: "insert-video",
        video: {
          src: "https://cdn.teamgaga.com/video.mp4",
          width: "1280",
          height: "720",
          mimeType: "video/mp4",
          fileSize: 1048576,
          poster: "https://cdn.teamgaga.com/poster.png",
          duration: 30,
        },
        selection: { start: 1, end: 2 },
      },
      {
        type: "insert-link",
        link: { url: "https://teamgaga.com", text: "TeamGaga" },
        selection: { start: 0, end: 5 },
      },
      { type: "insert-divider" },
      { type: "indent" },
      { type: "outdent" },
      { type: "undo" },
      { type: "redo" },
    ]);
    expect(
      responses.find((response) => response.ok && response.type === "get_caret_rect"),
    ).toMatchObject({ value: { rect: null } });
    expect(editor.getState().focused).toBe(false);

    editor.destroy();
  });

  it("converts execution exceptions into safe failure responses", () => {
    const adapter = new MockEditorAdapter();
    adapter.execute = () => {
      throw new Error("Sensitive internal failure.");
    };
    const editor = createEditor({ adapter });
    const command = getFixtureCommands().find(({ type }) => type === "toggle_inline_format");

    if (!command) {
      throw new Error("Inline format fixture is required.");
    }

    const response = dispatchEditorCommand(editor, command);

    expect(response).toEqual({
      version: PROTOCOL_VERSION,
      kind: "response",
      id: command.id,
      ok: false,
      error: {
        code: "command_failed",
        message: "Editor command failed.",
      },
    });
    expect(JSON.stringify(response)).not.toContain("Sensitive internal failure");
    expect(parseProtocolMessage(response).ok).toBe(true);
  });
});
