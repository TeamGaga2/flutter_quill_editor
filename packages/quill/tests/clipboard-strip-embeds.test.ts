import { describe, expect, it } from "vite-plus/test";
import { Delta } from "quill";
import {
  extractPlainText,
  rewriteCopyHtml,
  stripEmbeds,
  stripPasteHtml,
} from "../src/clipboard/clipboard-policy";

describe("clipboard stripEmbeds, extractPlainText, rewriteCopyHtml, and stripPasteHtml (ADR-0008 / ADR-0007)", () => {
  describe("stripEmbeds", () => {
    it("keeps text ops, inline embeds (mention, channel, emoji), dividers, and valid media embeds, drops invalid media", () => {
      const input = new Delta()
        .insert("hi ", { bold: true })
        .insert({ mention: { id: "u1", sign: "!", displayText: "Alice" } })
        .insert(" check ")
        .insert({ channel: { id: "c1", displayText: "general" } })
        .insert(" ")
        .insert({ emoji: { id: "party_parrot" } })
        .insert({ divider: "true" })
        .insert(
          { image: "https://example/valid.png" },
          { width: "100", height: "100", mimeType: "image/png", fileSize: 1024 },
        )
        .insert(
          { video: "https://example/valid.mp4" },
          {
            width: "200",
            height: "150",
            mimeType: "video/mp4",
            fileSize: 2048,
            duration: 10,
            poster: "https://example/poster.jpg",
          },
        )
        .insert({ image: "https://example/no-attrs.png" }) // invalid -> dropped
        .insert({ video: "https://example/no-attrs.mp4" }) // invalid -> dropped
        .insert("\n");

      const output = stripEmbeds(input);

      expect(output.ops).toEqual([
        { insert: "hi ", attributes: { bold: true } },
        { insert: { mention: { id: "u1", sign: "!", displayText: "Alice" } } },
        { insert: " check " },
        { insert: { channel: { id: "c1", displayText: "general" } } },
        { insert: " " },
        { insert: { emoji: { id: "party_parrot" } } },
        { insert: { divider: "true" } },
        {
          insert: {
            image: {
              src: "https://example/valid.png",
              width: "100",
              height: "100",
              mimeType: "image/png",
              fileSize: 1024,
            },
          },
        },
        {
          insert: {
            video: {
              src: "https://example/valid.mp4",
              width: "200",
              height: "150",
              mimeType: "video/mp4",
              fileSize: 2048,
              duration: 10,
              poster: "https://example/poster.jpg",
            },
          },
        },
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

    it("handles canonical string-based embed Delta ops including divider", () => {
      const input = new Delta()
        .insert({ mention: "u1" }, { sign: "&", displayText: "Staff" })
        .insert(" ")
        .insert({ channel: "c1" }, { displayText: "general" })
        .insert(" ")
        .insert({ emoji: "tada" })
        .insert({ divider: "true" })
        .insert("\n");

      const output = stripEmbeds(input);

      expect(output.ops).toEqual([
        { insert: { mention: { id: "u1", sign: "&", displayText: "Staff" } } },
        { insert: " " },
        { insert: { channel: { id: "c1", displayText: "general" } } },
        { insert: " " },
        { insert: { emoji: { id: "tada" } } },
        { insert: { divider: "true" } },
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
    it("extracts formatted plain text from Delta ops including divider and media fallback tags", () => {
      const delta = new Delta()
        .insert("Hello ")
        .insert({ mention: { id: "u1", sign: "!", displayText: "Alice" } })
        .insert(" in ")
        .insert({ channel: { id: "c1", displayText: "dev-room" } })
        .insert(" ")
        .insert({ emoji: { id: "tada" } })
        .insert("\n")
        .insert({ divider: "true" })
        .insert({ image: "https://example/photo.png" })
        .insert({ video: "https://example/video.mp4" })
        .insert("World\n");

      expect(extractPlainText(delta)).toBe(
        "Hello @Alice in #dev-room :tada:\n---\n[图片]\n[视频]\nWorld\n",
      );
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
    it("rewrites emoji spans to :id: text, preserves dividers, preserves .tgg-image and .tgg-video, strips foreign media", () => {
      const html =
        '<p>Hello <span class="tgg-mention" data-id="u1" data-sign="!" data-display="Alice">@Alice</span> ' +
        '<span class="tgg-emoji" data-emoji-id="tada" data-emoji-missing="true"><img src="blob:http://localhost/123" alt=":tada:"></span> ' +
        '<img class="tgg-image" data-src="tgg-local-media://uuid1" width="100" height="100" data-mime-type="image/png" data-file-size="1024">' +
        '<div class="tgg-video" data-src="tgg-local-media://uuid2" width="200" height="150" data-mime-type="video/mp4" data-file-size="2048"><video class="tgg-video__media"></video></div>' +
        '<img class="foreign-image" src="https://example.com/bad.png">' +
        '<video class="foreign-video" src="https://example.com/bad.mp4"></video>' +
        '<hr class="tgg-divider">' +
        '<span class="tgg-channel" data-id="c1" data-display="general">#general</span></p>';

      const rewritten = rewriteCopyHtml(html);

      expect(rewritten).toContain(
        'class="tgg-mention" data-id="u1" data-sign="!" data-display="Alice">@Alice</span>',
      );
      expect(rewritten).toContain('<span class="tgg-emoji" data-emoji-id="tada">:tada:</span>');
      expect(rewritten).toContain('<hr class="tgg-divider">');
      expect(rewritten).toContain('class="tgg-image"');
      expect(rewritten).toContain('data-src="tgg-local-media://uuid1"');
      expect(rewritten).toContain('class="tgg-video"');
      expect(rewritten).toContain('data-src="tgg-local-media://uuid2"');
      expect(rewritten).not.toContain("foreign-image");
      expect(rewritten).not.toContain("foreign-video");
      expect(rewritten).not.toContain("data-emoji-missing");
      expect(rewritten).not.toContain("blob:");
      expect(rewritten).toContain(
        'class="tgg-channel" data-id="c1" data-display="general">#general</span>',
      );
    });
  });

  describe("stripPasteHtml", () => {
    it("clears inner children of emoji spans, preserves dividers (<hr>), preserves .tgg-image and .tgg-video, strips foreign media", () => {
      const html =
        '<p>Text <span class="tgg-emoji" data-emoji-id="party_parrot"><img src="https://example.com/parrot.png" alt=":parrot:"></span> ' +
        '<img class="tgg-image" data-src="tgg-local-media://uuid1" width="100" height="100" data-mime-type="image/png" data-file-size="1024">' +
        '<div class="tgg-video" data-src="tgg-local-media://uuid2" width="200" height="150" data-mime-type="video/mp4" data-file-size="2048"></div>' +
        '<img src="https://example.com/foreign.png">' +
        "<hr>" +
        "End</p>";

      const stripped = stripPasteHtml(html);

      expect(stripped).toContain('<span class="tgg-emoji" data-emoji-id="party_parrot"></span>');
      expect(stripped).toContain("<hr>");
      expect(stripped).toContain('class="tgg-image"');
      expect(stripped).toContain('class="tgg-video"');
      expect(stripped).not.toContain("https://example.com/foreign.png");
      expect(stripped).toContain("Text ");
      expect(stripped).toContain("End");
    });
  });
});
