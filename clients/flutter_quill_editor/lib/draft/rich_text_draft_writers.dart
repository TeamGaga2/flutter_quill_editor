import 'package:flutter_quill_editor/draft/draft_writer.dart';

/// Process-local registry so toolbars can cancel/flush the active page writer
/// without holding a page reference (replaces EasyDebounce draft keys).
class RichTextDraftWriters {
  RichTextDraftWriters._();

  static final Map<String, DraftWriter> _writers = <String, DraftWriter>{};

  static void register(String draftKey, DraftWriter writer) {
    _writers[draftKey] = writer;
  }

  static void unregister(String draftKey, DraftWriter writer) {
    if (_writers[draftKey] == writer) {
      _writers.remove(draftKey);
    }
  }

  static DraftWriter? of(String draftKey) => _writers[draftKey];

  static void cancelPending(String draftKey) {
    _writers[draftKey]?.cancel();
  }

  static Future<void> flush(String draftKey) async {
    await _writers[draftKey]?.flush();
  }
}
