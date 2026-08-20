import { createEffect, onCleanup, type JSX } from "solid-js";
import { render } from "solid-js/web";
import {
  createRichTextEditor,
  RichTextEditor,
  RichTextProvider,
  useRichText,
} from "@teamgaga/richtext-solid";
import { RichTextToolbar } from "@teamgaga/richtext-solid-toolbar";
import "@teamgaga/richtext-solid/style.css";
import "./style.css";

function SnapshotDebug(): JSX.Element {
  const controller = useRichText();
  let output: HTMLPreElement | undefined;

  createEffect(() => {
    const editor = controller.editor();

    if (!editor || !output) {
      return;
    }

    const update = (): void => {
      output!.textContent = JSON.stringify(editor.getSnapshot(), null, 2);
    };

    update();
    onCleanup(editor.on("change", update));
  });

  return (
    <pre
      class="snapshot"
      ref={(element) => {
        output = element;
      }}
      aria-label="Rich text snapshot"
    />
  );
}

function App(): JSX.Element {
  const editor = createRichTextEditor();

  return (
    <main class="page">
      <header>
        <p class="eyebrow">@teamgaga/richtext-solid-toolbar</p>
        <h1>RichText Toolbar Playground</h1>
        <p>Select text or place the caret in a line, then use the Core-driven toolbar.</p>
      </header>

      <RichTextProvider editor={editor}>
        <section class="editor-shell">
          <RichTextToolbar
            class="toolbar"
            aria-label="Rich text formatting"
            visibleInsertActions={["emoji", "mention", "channel", "image"]}
            onRequestEmoji={(selection) => console.log("request_emoji", selection)}
            onRequestMention={(selection) => console.log("request_mention", selection)}
            onRequestChannel={(selection) => console.log("request_channel", selection)}
            onRequestImage={(selection) => console.log("request_image", selection)}
          />
          <RichTextEditor class="editor" aria-label="Rich text editor" />
        </section>

        <section>
          <h2>Snapshot</h2>
          <SnapshotDebug />
        </section>
      </RichTextProvider>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Playground root was not found.");
}

render(() => <App />, root);
