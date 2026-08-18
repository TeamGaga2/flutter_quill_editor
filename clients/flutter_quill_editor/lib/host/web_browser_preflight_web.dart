// ignore_for_file: invalid_runtime_check_with_js_interop_types, cast_nullable_to_non_nullable

import 'dart:async';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:flutter_quill_editor/host/web_browser_preflight.dart';
import 'package:web/web.dart' as web;

Future<WebBrowserPreflightResult> runWebBrowserPreflight() async {
  try {
    final channel = web.MessageChannel();
    channel.port1.close();
    channel.port2.close();
  } on Object catch (error) {
    return WebBrowserPreflightResult.failed('MessageChannel unavailable: $error');
  }

  try {
    await _probeIndexedDb();
  } on Object catch (error) {
    return WebBrowserPreflightResult.failed('IndexedDB Blob probe failed: $error');
  }

  return const WebBrowserPreflightResult.ok();
}

Future<void> _probeIndexedDb() async {
  const dbName = 'tg.richtext.preflight';
  const storeName = 'probe';
  final indexedDb = web.window.indexedDB;
  final openRequest = indexedDb.open(dbName, 1);
  openRequest.onupgradeneeded = (web.Event event) {
    final db = openRequest.result as web.IDBDatabase;
    if (!db.objectStoreNames.contains(storeName)) {
      db.createObjectStore(storeName);
    }
  }.toJS;
  final db = await _complete<web.IDBDatabase>(openRequest);
  try {
    final bytes = Uint8List.fromList(const [1, 2, 3, 4]);
    final writeTx = db.transaction(storeName.toJS, 'readwrite');
    writeTx.objectStore(storeName).put(bytes.toJS, 'probe'.toJS);
    await _completeTx(writeTx);

    final readTx = db.transaction(storeName.toJS, 'readonly');
    final raw = await _complete<JSAny?>(readTx.objectStore(storeName).get('probe'.toJS));
    await _completeTx(readTx);
    if (raw == null) {
      throw StateError('IndexedDB probe read returned null');
    }

    final deleteTx = db.transaction(storeName.toJS, 'readwrite');
    deleteTx.objectStore(storeName).delete('probe'.toJS);
    await _completeTx(deleteTx);
  } finally {
    db.close();
    indexedDb.deleteDatabase(dbName);
  }
}

Future<T> _complete<T>(web.IDBRequest request) {
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
        );
      }
    }.toJS;
  return completer.future;
}

Future<void> _completeTx(web.IDBTransaction tx) {
  final completer = Completer<void>();
  tx
    ..oncomplete = (web.Event event) {
      if (!completer.isCompleted) completer.complete();
    }.toJS
    ..onerror = (web.Event event) {
      if (!completer.isCompleted) {
        completer.completeError(tx.error ?? StateError('IndexedDB transaction failed'));
      }
    }.toJS
    ..onabort = (web.Event event) {
      if (!completer.isCompleted) {
        completer.completeError(tx.error ?? StateError('IndexedDB transaction aborted'));
      }
    }.toJS;
  return completer.future;
}
