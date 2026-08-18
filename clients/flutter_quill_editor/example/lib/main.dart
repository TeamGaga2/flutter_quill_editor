import 'package:flutter/material.dart';
import 'package:flutter_quill_editor/flutter_quill_editor.dart';

void main() => runApp(const EditorExampleApp());

class EditorExampleApp extends StatelessWidget {
  const EditorExampleApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'flutter_quill_editor example',
    theme: ThemeData(colorSchemeSeed: Colors.blue, useMaterial3: true),
    home: const EditorExamplePage(),
  );
}

class EditorExamplePage extends StatefulWidget {
  const EditorExamplePage({super.key});

  @override
  State<EditorExamplePage> createState() => _EditorExamplePageState();
}

class _EditorExamplePageState extends State<EditorExamplePage> {
  RichTextEditorController? _controller;
  String _status = 'loading editor…';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('flutter_quill_editor example')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                TextButton(
                  onPressed: () =>
                      _controller?.toggleInlineFormat(ProtocolInlineFormat.bold),
                  child: const Text('Bold'),
                ),
                TextButton(
                  onPressed: () =>
                      _controller?.toggleInlineFormat(ProtocolInlineFormat.italic),
                  child: const Text('Italic'),
                ),
                TextButton(
                  onPressed: () => _controller?.undo(),
                  child: const Text('Undo'),
                ),
                TextButton(
                  onPressed: () => _controller?.redo(),
                  child: const Text('Redo'),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    _status,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.end,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: RichTextWebView(
              onControllerReady: (controller) {
                setState(() => _controller = controller);
              },
              onReady: () => setState(() => _status = 'ready'),
              onFailure: (failure) {
                setState(() => _status = 'failed: ${failure.stage.name}');
              },
              placeholder: 'Type something…',
            ),
          ),
        ],
      ),
    );
  }
}
