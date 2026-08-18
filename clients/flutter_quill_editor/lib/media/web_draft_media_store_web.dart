// ignore_for_file: invalid_runtime_check_with_js_interop_types, cast_nullable_to_non_nullable

import 'dart:async';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:flutter_quill_editor/media/web_draft_media_store.dart';
import 'package:web/web.dart' as web;

/// IndexedDB-backed [WebDraftMediaStore] (ADR-0008).
WebDraftMediaStore createWebDraftMediaStore() => IndexedDbWebDraftMediaStore();

class IndexedDbWebDraftMediaStore implements WebDraftMediaStore {
  static const _dbName = 'tg.richtext.draft-media';
  static const _storeName = 'media';
  static const _dbVersion = 1;

  Future<web.IDBDatabase>? _dbFuture;

  Future<web.IDBDatabase> _open() {
    return _dbFuture ??= () async {
      final indexedDb = web.window.indexedDB;
      final request = indexedDb.open(_dbName, _dbVersion);
      request.onupgradeneeded = (web.Event event) {
        final db = request.result as web.IDBDatabase;
        if (!db.objectStoreNames.contains(_storeName)) {
          db
              .createObjectStore(
                _storeName,
                web.IDBObjectStoreParameters(keyPath: 'id'.toJS),
              )
              .createIndex('draftKey', 'draftKey'.toJS);
        }
      }.toJS;
      return _completeRequest<web.IDBDatabase>(request);
    }();
  }

  @override
  Future<void> put(WebDraftMediaRecord record) async {
    final db = await _open();
    final tx = db.transaction(_storeName.toJS, 'readwrite');
    final value = <String, Object?>{
      'id': MemoryWebDraftMediaStore.keyFor(record.draftKey, record.token),
      'draftKey': record.draftKey,
      'token': record.token,
      'mimeType': record.mimeType,
      'fileName': record.fileName,
      'fileSize': record.fileSize,
      'createdAt': record.createdAt.toUtc().toIso8601String(),
      'metadata': record.metadata,
      'bytes': record.bytes,
    }.jsify();
    tx.objectStore(_storeName).put(value);
    await _completeTransaction(tx);
  }

  @override
  Future<WebDraftMediaRecord?> get(String draftKey, String token) async {
    final db = await _open();
    final tx = db.transaction(_storeName.toJS, 'readonly');
    final raw = await _completeRequest<JSAny?>(
      tx.objectStore(_storeName).get(MemoryWebDraftMediaStore.keyFor(draftKey, token).toJS),
    );
    await _completeTransaction(tx);
    if (raw == null) return null;
    final map = _jsAnyToMap(raw);
    if (map == null) return null;
    return _recordFromMap(map);
  }

  @override
  Future<void> delete(String draftKey, String token) async {
    final db = await _open();
    final tx = db.transaction(_storeName.toJS, 'readwrite');
    tx.objectStore(_storeName).delete(MemoryWebDraftMediaStore.keyFor(draftKey, token).toJS);
    await _completeTransaction(tx);
  }

  @override
  Future<void> deleteDraft(String draftKey) async {
    final db = await _open();
    final tx = db.transaction(_storeName.toJS, 'readwrite');
    final index = tx.objectStore(_storeName).index('draftKey');
    final cursorRequest = index.openCursor(draftKey.toJS);
    final completer = Completer<void>();
    cursorRequest
      ..onsuccess = (web.Event event) {
        final cursor = cursorRequest.result as web.IDBCursorWithValue?;
        if (cursor == null) {
          if (!completer.isCompleted) completer.complete();
          return;
        }
        cursor
          ..delete()
          ..continue_();
      }.toJS
      ..onerror = (web.Event event) {
        if (!completer.isCompleted) {
          completer.completeError(
            cursorRequest.error ?? StateError('IndexedDB cursor failed'),
            StackTrace.current,
          );
        }
      }.toJS;
    await completer.future;
    await _completeTransaction(tx);
  }

  @override
  Future<String> createObjectUrl(Uint8List bytes, String mimeType) async {
    final blob = web.Blob(
      [bytes.toJS].toJS,
      web.BlobPropertyBag(type: mimeType),
    );
    return web.URL.createObjectURL(blob);
  }

  @override
  Future<void> revokeObjectUrl(String objectUrl) async {
    web.URL.revokeObjectURL(objectUrl);
  }

  WebDraftMediaRecord _recordFromMap(Map<String, dynamic> map) {
    final bytesRaw = map['bytes'];
    late final Uint8List bytes;
    if (bytesRaw is Uint8List) {
      bytes = bytesRaw;
    } else if (bytesRaw is ByteBuffer) {
      bytes = bytesRaw.asUint8List();
    } else if (bytesRaw is List) {
      bytes = Uint8List.fromList(bytesRaw.cast<int>());
    } else {
      throw StateError('IndexedDB media record bytes are unreadable.');
    }
    final createdAtRaw = map['createdAt'];
    final createdAt = createdAtRaw is String
        ? DateTime.tryParse(createdAtRaw)?.toUtc() ?? DateTime.now().toUtc()
        : DateTime.now().toUtc();
    final metadataRaw = map['metadata'];
    final metadata = metadataRaw is Map
        ? metadataRaw.map((key, value) => MapEntry('$key', value))
        : const <String, Object?>{};
    return WebDraftMediaRecord(
      draftKey: map['draftKey'] as String,
      token: map['token'] as String,
      bytes: bytes,
      mimeType: map['mimeType'] as String? ?? 'application/octet-stream',
      fileName: map['fileName'] as String?,
      fileSize: (map['fileSize'] as num?)?.toInt() ?? bytes.length,
      createdAt: createdAt,
      metadata: metadata,
    );
  }
}

Future<T> _completeRequest<T>(web.IDBRequest request) {
  final completer = Completer<T>();
  request
    ..onsuccess = (web.Event event) {
      if (!completer.isCompleted) {
        completer.complete(request.result as T);
      }
    }.toJS
    ..onerror = (web.Event event) {
      if (!completer.isCompleted) {
        completer.completeError(
          request.error ?? StateError('IndexedDB request failed'),
          StackTrace.current,
        );
      }
    }.toJS;
  return completer.future;
}

Future<void> _completeTransaction(web.IDBTransaction tx) {
  final completer = Completer<void>();
  tx
    ..oncomplete = (web.Event event) {
      if (!completer.isCompleted) completer.complete();
    }.toJS
    ..onerror = (web.Event event) {
      if (!completer.isCompleted) {
        completer.completeError(
          tx.error ?? StateError('IndexedDB transaction failed'),
          StackTrace.current,
        );
      }
    }.toJS
    ..onabort = (web.Event event) {
      if (!completer.isCompleted) {
        completer.completeError(
          tx.error ?? StateError('IndexedDB transaction aborted'),
          StackTrace.current,
        );
      }
    }.toJS;
  return completer.future;
}

Map<String, dynamic>? _jsAnyToMap(JSAny data) {
  try {
    final decoded = data.dartify();
    if (decoded is Map) {
      return decoded.map((key, value) => MapEntry('$key', value));
    }
  } catch (_) {}
  return null;
}
