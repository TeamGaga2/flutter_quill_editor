import 'dart:async';

import 'package:flutter_quill_editor/draft/draft_page_lifecycle.dart';
import 'package:clock/clock.dart';

/// Builds the value to persist the next time [DraftWriter] actually writes.
///
/// Runs lazily at write time (not at [DraftWriter.write] call time) so the
/// expensive snapshot→delta→JSON encode happens at most once per coalesce
/// window instead of on every keystroke. Returning `null` means "delete the
/// draft" (matches the empty title + empty content case).
typedef DraftPayloadBuilder = String? Function();

/// Serial, latest-wins draft persistence with a bounded coalesce window
/// (ADR-0015 / plan §16).
///
/// [write] replaces any not-yet-persisted [DraftPayloadBuilder] — the window
/// is measured from the *first* pending write, so continuous typing cannot
/// postpone persistence forever. At most one write is ever in flight; a
/// write already running is never interrupted, and any [write]/[flush] that
/// arrives while one is in flight is queued and drained immediately after.
///
/// `visibilitychange(hidden)` / `pagehide` trigger an immediate [flush]; a
/// `beforeunload` guard is armed only while dirty or a write is in flight
/// (see `draft_page_lifecycle_web.dart`) and removed as soon as persistence
/// catches up.
class DraftWriter {
  DraftWriter({
    required Future<void> Function(String? payload) persist,
    this.coalesceWindow = const Duration(milliseconds: 250),
    DraftPageLifecycle? lifecycle,
    DateTime Function()? now,
  }) : _persist = persist,
       _lifecycle = lifecycle ?? createDraftPageLifecycle(),
       _now = now ?? clock.now {
    _unsubscribeHidden = _lifecycle.onHidden(() => unawaited(flush()));
  }

  final Future<void> Function(String? payload) _persist;
  final Duration coalesceWindow;
  final DraftPageLifecycle _lifecycle;

  /// Defaults to [clock] (`package:clock`), which `fakeAsync` transparently
  /// overrides in tests — inject only when a test needs its own [Clock].
  final DateTime Function() _now;
  late final void Function() _unsubscribeHidden;

  DraftPayloadBuilder? _pendingBuilder;
  DateTime? _pendingSince;
  Timer? _coalesceTimer;
  Completer<void>? _idle;
  var _writing = false;
  var _disposed = false;

  /// True while a write is queued and/or in flight — drives the
  /// dirty-only `beforeunload` guard.
  bool get isDirty => _pendingBuilder != null || _writing;

  /// Queues [buildPayload] as the latest-wins write and (re)arms the bounded
  /// coalesce timer. No-op after [dispose].
  void write(DraftPayloadBuilder buildPayload) {
    if (_disposed) return;
    _pendingBuilder = buildPayload;
    _pendingSince ??= _now();
    _lifecycle.setUnloadGuard(true);
    _armCoalesce();
  }

  /// Drops the pending write without persisting it (e.g. after send, where
  /// the caller performs its own remove).
  void cancel() {
    _coalesceTimer?.cancel();
    _coalesceTimer = null;
    _pendingBuilder = null;
    _pendingSince = null;
    _syncUnloadGuard();
  }

  /// Writes the pending payload now, awaiting any write already in flight
  /// first so persistence stays strictly serial. Safe to call with nothing
  /// pending (no-op).
  Future<void> flush() async {
    if (_disposed) return;
    _coalesceTimer?.cancel();
    _coalesceTimer = null;
    await _drain();
  }

  /// Flushes any pending write, then releases the lifecycle hooks.
  Future<void> dispose() async {
    if (_disposed) return;
    await flush();
    _disposed = true;
    _coalesceTimer?.cancel();
    _coalesceTimer = null;
    _unsubscribeHidden();
    _lifecycle.setUnloadGuard(false);
  }

  void _armCoalesce() {
    _coalesceTimer?.cancel();
    final since = _pendingSince ?? _now();
    final remaining = coalesceWindow - _now().difference(since);
    _coalesceTimer = Timer(remaining.isNegative ? Duration.zero : remaining, () {
      unawaited(_drain());
    });
  }

  Future<void> _drain() async {
    if (_disposed) return;
    if (_writing) {
      final idle = _idle ??= Completer<void>();
      await idle.future;
      if (_pendingBuilder != null) await _drain();
      return;
    }

    while (!_disposed && _pendingBuilder != null) {
      final builder = _pendingBuilder!;
      _pendingBuilder = null;
      _pendingSince = null;
      String? payload;
      try {
        payload = builder();
      } on Object {
        // Transient build failure (e.g. media not resolvable yet) — the next
        // write() gets another chance; do not wipe/resurrect the draft.
        continue;
      }
      _writing = true;
      try {
        await _persist(payload);
      } finally {
        _writing = false;
      }
    }
    _syncUnloadGuard();
    _completeIdleIfQuiet();
  }

  void _syncUnloadGuard() => _lifecycle.setUnloadGuard(isDirty);

  void _completeIdleIfQuiet() {
    if (_writing || _pendingBuilder != null) return;
    final idle = _idle;
    if (idle != null && !idle.isCompleted) idle.complete();
    _idle = null;
  }
}
