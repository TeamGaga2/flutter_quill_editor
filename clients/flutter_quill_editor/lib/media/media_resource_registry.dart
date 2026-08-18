import 'dart:async';

import 'package:flutter_quill_editor/media/web_draft_media_store.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter/foundation.dart';

/// Opaque local-media URI prefix shared by protocol snapshots (ADR-0007).
const String kLocalMediaUriPrefix = 'tgg-local-media://';

/// Cross-platform registry for unsent rich-text media resources.
///
/// Native entries map tokens to filesystem paths (loopback `/__tg_media__/`).
/// Flutter Web entries map tokens to Blob object URLs after IndexedDB persist.
class MediaResourceRegistry {
  MediaResourceRegistry({
    String Function()? tokenGenerator,
    WebDraftMediaStore? draftMediaStore,
    this.onRegisterObjectUrl,
    this.onRevokeObjectUrl,
  }) : _tokenGenerator = tokenGenerator ?? const Uuid().v4,
       _draftMediaStore = draftMediaStore ?? createWebDraftMediaStore();

  static const String uriPrefix = kLocalMediaUriPrefix;
  static final _uuidPattern = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
  );

  final String Function() _tokenGenerator;
  final WebDraftMediaStore _draftMediaStore;
  final Map<String, MediaResourceEntry> _entries = <String, MediaResourceEntry>{};
  final Map<String, String> _tokensByPath = <String, String>{};

  /// Called after a Web object URL is created so the iframe host can register it.
  final Future<void> Function(String token, String objectUrl, String? mimeType)?
  onRegisterObjectUrl;

  /// Called when a Web object URL is revoked.
  final Future<void> Function(String token)? onRevokeObjectUrl;

  /// Registers a filesystem [path] and returns its canonical protocol URI.
  String registerPath(String path, {String? mimeType}) {
    final existingToken = _tokensByPath[path];
    if (existingToken != null) {
      final existing = _entries[existingToken];
      if (existing != null && mimeType != null && mimeType != existing.mimeType) {
        _entries[existingToken] = existing.copyWith(mimeType: mimeType);
      }
      return '$uriPrefix$existingToken';
    }

    final token = _allocateToken();
    _entries[token] = MediaResourceEntry(path: path, mimeType: mimeType);
    _tokensByPath[path] = token;
    return '$uriPrefix$token';
  }

  /// Persists [bytes] to IndexedDB (Web), creates an object URL, registers with
  /// the host, and returns `tgg-local-media://<token>`.
  ///
  /// On persistence failure the entry is rolled back and the error is rethrown —
  /// callers must not insert into the editor.
  Future<String> registerBlob({
    required String draftKey,
    required Uint8List bytes,
    required String mimeType,
    String? fileName,
    Map<String, Object?> metadata = const <String, Object?>{},
  }) async {
    final token = _allocateToken();
    final record = WebDraftMediaRecord(
      draftKey: draftKey,
      token: token,
      bytes: bytes,
      mimeType: mimeType,
      fileName: fileName,
      fileSize: bytes.length,
      createdAt: DateTime.now().toUtc(),
      metadata: metadata,
    );

    try {
      await _draftMediaStore.put(record);
    } on Object {
      rethrow;
    }

    final objectUrl = await _draftMediaStore.createObjectUrl(bytes, mimeType);
    _entries[token] = MediaResourceEntry(
      objectUrl: objectUrl,
      bytes: bytes,
      mimeType: mimeType,
      draftKey: draftKey,
      fileName: fileName,
    );

    try {
      await onRegisterObjectUrl?.call(token, objectUrl, mimeType);
    } on Object {
      await _rollbackBlob(token, draftKey: draftKey, objectUrl: objectUrl);
      rethrow;
    }

    return '$uriPrefix$token';
  }

  /// Restores IndexedDB Blobs for [tokens] under [draftKey], recreates object
  /// URLs, and notifies the host. Missing required records throw.
  Future<void> restoreDraft({
    required String draftKey,
    required Iterable<String> tokens,
  }) async {
    for (final tokenOrUri in tokens) {
      final token = _normalizeToken(tokenOrUri);
      if (token == null) continue;
      if (_entries.containsKey(token) && _entries[token]?.objectUrl != null) {
        continue;
      }
      final record = await _draftMediaStore.get(draftKey, token);
      if (record == null) {
        throw StateError('Draft media missing for token $token under $draftKey.');
      }
      final objectUrl = await _draftMediaStore.createObjectUrl(
        record.bytes,
        record.mimeType,
      );
      _entries[token] = MediaResourceEntry(
        objectUrl: objectUrl,
        bytes: record.bytes,
        mimeType: record.mimeType,
        draftKey: draftKey,
        fileName: record.fileName,
      );
      await onRegisterObjectUrl?.call(token, objectUrl, record.mimeType);
    }
  }

  MediaResourceEntry? lookup(String tokenOrUri) {
    final token = _normalizeToken(tokenOrUri);
    if (token == null) return null;
    return _entries[token];
  }

  String? pathForToken(String tokenOrUri) => lookup(tokenOrUri)?.path;

  String? objectUrlForToken(String tokenOrUri) => lookup(tokenOrUri)?.objectUrl;

  Future<Uint8List?> readBytes(String tokenOrUri) async {
    final entry = lookup(tokenOrUri);
    if (entry == null) return null;
    if (entry.bytes != null) return entry.bytes;
    final draftKey = entry.draftKey;
    final token = _normalizeToken(tokenOrUri);
    if (draftKey == null || token == null) return null;
    final record = await _draftMediaStore.get(draftKey, token);
    return record?.bytes;
  }

  Future<void> deleteTokens(String draftKey, Iterable<String> tokens) async {
    for (final tokenOrUri in tokens) {
      final token = _normalizeToken(tokenOrUri);
      if (token == null) continue;
      final entry = _entries.remove(token);
      if (entry?.path != null) {
        _tokensByPath.removeWhere((_, value) => value == token);
      }
      if (entry?.objectUrl != null) {
        await _draftMediaStore.revokeObjectUrl(entry!.objectUrl!);
        await onRevokeObjectUrl?.call(token);
      }
      await _draftMediaStore.delete(draftKey, token);
    }
  }

  bool contains(String tokenOrUri) => lookup(tokenOrUri) != null;

  @visibleForTesting
  int get length => _entries.length;

  void clear() {
    for (final entry in _entries.values) {
      final objectUrl = entry.objectUrl;
      if (objectUrl != null) {
        unawaited(_draftMediaStore.revokeObjectUrl(objectUrl));
      }
    }
    _entries.clear();
    _tokensByPath.clear();
  }

  /// Revokes Web object URLs without deleting IndexedDB records (dispose/retry).
  Future<void> revokeObjectUrls() async {
    for (final entry in _entries.entries) {
      final objectUrl = entry.value.objectUrl;
      if (objectUrl == null) continue;
      await _draftMediaStore.revokeObjectUrl(objectUrl);
      await onRevokeObjectUrl?.call(entry.key);
      _entries[entry.key] = entry.value.copyWith(clearObjectUrl: true);
    }
  }

  /// Recreates Blob object URLs for [tokens] and re-registers them with the host.
  ///
  /// Used after host retry: IndexedDB / in-memory bytes survive, but the new
  /// iframe generation needs fresh object URLs and registerMedia calls.
  Future<void> rebindObjectUrls({required Iterable<String> tokens}) async {
    for (final tokenOrUri in tokens) {
      final token = _normalizeToken(tokenOrUri);
      if (token == null) continue;
      final existing = _entries[token];
      var bytes = existing?.bytes;
      var mimeType = existing?.mimeType ?? 'application/octet-stream';
      final draftKey = existing?.draftKey;
      if (bytes == null && draftKey != null) {
        final record = await _draftMediaStore.get(draftKey, token);
        if (record != null) {
          bytes = record.bytes;
          mimeType = record.mimeType;
        }
      }
      if (bytes == null) {
        throw StateError('Cannot rebind media token $token without bytes.');
      }
      final oldUrl = existing?.objectUrl;
      if (oldUrl != null) {
        await _draftMediaStore.revokeObjectUrl(oldUrl);
        await onRevokeObjectUrl?.call(token);
      }
      final objectUrl = await _draftMediaStore.createObjectUrl(bytes, mimeType);
      _entries[token] = MediaResourceEntry(
        objectUrl: objectUrl,
        bytes: bytes,
        mimeType: mimeType,
        draftKey: draftKey ?? existing?.draftKey,
        fileName: existing?.fileName,
        path: existing?.path,
      );
      await onRegisterObjectUrl?.call(token, objectUrl, mimeType);
    }
  }

  Future<void> _rollbackBlob(
    String token, {
    required String draftKey,
    required String objectUrl,
  }) async {
    _entries.remove(token);
    await _draftMediaStore.revokeObjectUrl(objectUrl);
    await _draftMediaStore.delete(draftKey, token);
  }

  String _allocateToken() {
    for (var attempt = 0; attempt < 16; attempt++) {
      final candidate = _tokenGenerator();
      if (!_uuidPattern.hasMatch(candidate)) {
        throw StateError('Local media token generator must return a UUID.');
      }
      if (!_entries.containsKey(candidate)) {
        return candidate;
      }
    }
    throw StateError('Local media token generator did not return a unique UUID.');
  }

  String? _normalizeToken(String tokenOrUri) {
    final token = tokenOrUri.startsWith(uriPrefix)
        ? tokenOrUri.substring(uriPrefix.length)
        : tokenOrUri;
    if (!_uuidPattern.hasMatch(token)) {
      return null;
    }
    return token;
  }
}

/// Prefer [MediaResourceRegistry]; kept for existing typedefs / imports.
typedef LocalMediaRegistry = MediaResourceRegistry;

class MediaResourceEntry {
  const MediaResourceEntry({
    this.path,
    this.objectUrl,
    this.bytes,
    this.mimeType,
    this.draftKey,
    this.fileName,
  });

  final String? path;
  final String? objectUrl;
  final Uint8List? bytes;
  final String? mimeType;
  final String? draftKey;
  final String? fileName;

  MediaResourceEntry copyWith({
    String? path,
    String? objectUrl,
    Uint8List? bytes,
    String? mimeType,
    String? draftKey,
    String? fileName,
    bool clearObjectUrl = false,
  }) {
    return MediaResourceEntry(
      path: path ?? this.path,
      objectUrl: clearObjectUrl ? null : (objectUrl ?? this.objectUrl),
      bytes: bytes ?? this.bytes,
      mimeType: mimeType ?? this.mimeType,
      draftKey: draftKey ?? this.draftKey,
      fileName: fileName ?? this.fileName,
    );
  }
}

/// Backward-compatible alias for path-backed entries.
typedef LocalMediaEntry = MediaResourceEntry;
