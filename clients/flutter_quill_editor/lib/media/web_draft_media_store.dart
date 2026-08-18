import 'dart:typed_data';

import 'package:flutter_quill_editor/media/web_draft_media_store_stub.dart'
    if (dart.library.html) 'package:flutter_quill_editor/media/web_draft_media_store_web.dart'
    as impl;

/// One persisted unsent media Blob for a draft (ADR-0008).
class WebDraftMediaRecord {
  const WebDraftMediaRecord({
    required this.draftKey,
    required this.token,
    required this.bytes,
    required this.mimeType,
    required this.fileSize,
    required this.createdAt,
    this.fileName,
    this.metadata = const <String, Object?>{},
  });

  final String draftKey;
  final String token;
  final Uint8List bytes;
  final String mimeType;
  final int fileSize;
  final DateTime createdAt;
  final String? fileName;
  final Map<String, Object?> metadata;
}

/// Platform draft-media persistence + object-URL helpers.
abstract class WebDraftMediaStore {
  Future<void> put(WebDraftMediaRecord record);

  Future<WebDraftMediaRecord?> get(String draftKey, String token);

  Future<void> delete(String draftKey, String token);

  /// Deletes every record under [draftKey].
  Future<void> deleteDraft(String draftKey);

  Future<String> createObjectUrl(Uint8List bytes, String mimeType);

  Future<void> revokeObjectUrl(String objectUrl);
}

/// In-memory store used by native builds and unit tests.
class MemoryWebDraftMediaStore implements WebDraftMediaStore {
  final Map<String, WebDraftMediaRecord> _records = <String, WebDraftMediaRecord>{};
  var _objectUrlSeq = 0;

  static String keyFor(String draftKey, String token) => '$draftKey\u0000$token';

  @override
  Future<void> put(WebDraftMediaRecord record) async {
    _records[keyFor(record.draftKey, record.token)] = record;
  }

  @override
  Future<WebDraftMediaRecord?> get(String draftKey, String token) async {
    return _records[keyFor(draftKey, token)];
  }

  @override
  Future<void> delete(String draftKey, String token) async {
    _records.remove(keyFor(draftKey, token));
  }

  @override
  Future<void> deleteDraft(String draftKey) async {
    _records.removeWhere((key, _) => key.startsWith('$draftKey\u0000'));
  }

  @override
  Future<String> createObjectUrl(Uint8List bytes, String mimeType) async {
    _objectUrlSeq += 1;
    return 'blob:memory/$_objectUrlSeq-${bytes.length}-$mimeType';
  }

  @override
  Future<void> revokeObjectUrl(String objectUrl) async {}
}

/// Platform factory — IndexedDB on Flutter Web, memory elsewhere.
WebDraftMediaStore createWebDraftMediaStore() => impl.createWebDraftMediaStore();
