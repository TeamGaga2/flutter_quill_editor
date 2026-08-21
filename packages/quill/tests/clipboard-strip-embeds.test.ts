import { describe, expect, it } from "vite-plus/test";
import { Delta } from "quill";
import {
  extractPlainText,
  rewriteCopyHtml,
  stripEmbeds,
  stripPasteHtml,
} from "../src/clipboard/clipboard-policy";

describe("clipboard stripEmbeds, extractPlainText, rewriteCopyHtml, and stripPasteHtml", () => {
  describe("stripEmbeds", () => {
    it("keeps text ops and inline embeds (mention, channel, emoji), drops block embeds", () => {
      const input = new Delta()
        .insert("hi ", { bold: true })
        .insert({ mention: { id: "u1", sign: "!", displayText: "Alice" } })
        .insert(" check ")
        .insert({ channel: { id: "c1", displayText: "general" } })
        .insert(" ")
        .insert({ emoji: { id: "party_parrot" } })
        .insert({ image: "https://example/x.png" })
        .insert({ video: "https://example/v.mp4" })
        .insert({ divider: "true" })
        .insert("\n");

      const output = stripEmbeds(input);

      expect(output.ops).toEqual([
        { insert: "hi ", attributes: { bold: true } },
        { insert: { mention: { id: "u1", sign: "!", displayText: "Alice" } } },
        { insert: " check " },
        { insert: { channel: { id: "c1", displayText: "general" } } },
        { insert: " " },
        { insert: { emoji: { id: "party_parrot" } } },
        { insert: "\n" },
      ]);
    });

    it("degrades malformed mentions and channels without IDs to plain text", () => {
      const input = new Delta()
        .insert({ mention: { id: "", sign: "!", displayText: "Ghost" } })
        .insert(" ")
        .insert({ channel: { id: "", displayText: "invalid" } })
        .insert(" ")
        .insert({ emoji: { id: "" } })
        .insert("\n");

      const output = stripEmbeds(input);

      expect(output.ops).toEqual([{ insert: "@Ghost #invalid \n" }]);
    });

    it("drops mentions and channels with ID but missing displayText without leaking ID", () => {
      const input = new Delta()
        .insert("before ")
        .insert({ mention: { id: "u123", sign: "!", displayText: "" } })
        .insert({ channel: { id: "c456", displayText: "" } })
        .insert("after\n");

      const output = stripEmbeds(input);

      expect(output.ops).toEqual([{ insert: "before after\n" }]);
    });

    it("defaults invalid or missing sign to '!' for mentions", () => {
      const input = new Delta()
        .insert({ mention: { id: "u1", sign: "unknown" as any, displayText: "Bob" } })
        .insert(" ")
        .insert({ mention: { id: "u2", sign: "&", displayText: "Staff" } })
        .insert("\n");

      const output = stripEmbeds(input);

      expect(output.ops).toEqual([
        { insert: { mention: { id: "u1", sign: "!", displayText: "Bob" } } },
        { insert: " " },
        { insert: { mention: { id: "u2", sign: "&", displayText: "Staff" } } },
        { insert: "\n" },
      ]);
    });

    it("handles canonical string-based embed Delta ops", () => {
      const input = new Delta()
        .insert({ mention: "u1" }, { sign: "&", displayText: "Staff" })
        .insert(" ")
        .insert({ channel: "c1" }, { displayText: "general" })
        .insert(" ")
        .insert({ emoji: "tada" })
        .insert("\n");

      const output = stripEmbeds(input);

      expect(output.ops).toEqual([
        { insert: { mention: { id: "u1", sign: "&", displayText: "Staff" } } },
        { insert: " " },
        { insert: { channel: { id: "c1", displayText: "general" } } },
        { insert: " " },
        { insert: { emoji: { id: "tada" } } },
        { insert: "\n" },
      ]);
    });

    it("degrades string-based mentions/channels without ID or drops if missing display", () => {
      const input = new Delta()
        .insert({ mention: "" }, { displayText: "NoId" })
        .insert(" ")
        .insert({ mention: "u99" }, {}) // has ID, no displayText -> drop
        .insert({ channel: "" }, { displayText: "NoChannelId" })
        .insert(" ")
        .insert({ channel: "c99" }, {}) // has ID, no displayText -> drop
        .insert({ emoji: "" }) // no ID -> drop
        .insert("\n");

      const output = stripEmbeds(input);

      expect(output.ops).toEqual([{ insert: "@NoId #NoChannelId \n" }]);
    });
  });

  describe("extractPlainText", () => {
    it("extracts formatted plain text from Delta ops and ignores block media", () => {
      const delta = new Delta()
        .insert("Hello ")
        .insert({ mention: { id: "u1", sign: "!", displayText: "Alice" } })
        .insert(" in ")
        .insert({ channel: { id: "c1", displayText: "dev-room" } })
        .insert(" ")
        .insert({ emoji: { id: "tada" } })
        .insert({ image: "https://example/photo.png" })
        .insert({ video: "https://example/video.mp4" })
        .insert({ divider: "true" })
        .insert("\n");

      expect(extractPlainText(delta)).toBe("Hello @Alice in #dev-room :tada:\n");
    });

    it("extracts formatted plain text from canonical string embed ops", () => {
      const delta = new Delta()
        .insert("Hi ")
        .insert({ mention: "u1" }, { sign: "!", displayText: "Bob" })
        .insert(" ")
        .insert({ channel: "c1" }, { displayText: "general" })
        .insert(" ")
        .insert({ emoji: "party_parrot" })
        .insert("\n");

      expect(extractPlainText(delta)).toBe("Hi @Bob #general :party_parrot:\n");
    });
  });

  describe("rewriteCopyHtml", () => {
    it("rewrites emoji spans to :id: text, removes <img> and data-emoji-missing, strips block media and dividers", () => {
      const html =
        '<p>Hello <span class="tgg-mention" data-id="u1" data-sign="!" data-display="Alice">@Alice</span> ' +
        '<span class="tgg-emoji" data-emoji-id="tada" data-emoji-missing="true"><img src="blob:http://localhost/123" alt=":tada:"></span> ' +
        '<img class="tgg-image" src="https://example.com/bad.png">' +
        '<video class="tgg-video" src="https://example.com/v.mp4"></video>' +
        '<hr class="tgg-divider">' +
        '<span class="tgg-channel" data-id="c1" data-display="general">#general</span></p>';

      const rewritten = rewriteCopyHtml(html);

      expect(rewritten).toContain(
        'class="tgg-mention" data-id="u1" data-sign="!" data-display="Alice">@Alice</span>',
      );
      expect(rewritten).toContain('<span class="tgg-emoji" data-emoji-id="tada">:tada:</span>');
      expect(rewritten).not.toContain("<img");
      expect(rewritten).not.toContain("<video");
      expect(rewritten).not.toContain("<hr");
      expect(rewritten).not.toContain("data-emoji-missing");
      expect(rewritten).not.toContain("blob:");
      expect(rewritten).toContain(
        'class="tgg-channel" data-id="c1" data-display="general">#general</span>',
      );
    });
  });

  describe("stripPasteHtml", () => {
    it("clears inner children of emoji spans and strips block media/dividers", () => {
      const html =
        '<p>Text <span class="tgg-emoji" data-emoji-id="party_parrot"><img src="https://example.com/parrot.png" alt=":parrot:"></span> ' +
        '<img src="https://example.com/bad.png">' +
        "<hr>" +
        "End</p>";

      const stripped = stripPasteHtml(html);

      expect(stripped).toContain('<span class="tgg-emoji" data-emoji-id="party_parrot"></span>');
      expect(stripped).not.toContain("<img");
      expect(stripped).not.toContain("<hr");
      expect(stripped).toContain("Text ");
      expect(stripped).toContain("End");
    });
  });
});
