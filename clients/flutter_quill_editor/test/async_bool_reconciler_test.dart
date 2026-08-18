import 'dart:async';

import 'package:flutter_quill_editor/async_bool_reconciler.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('slow block that finishes after unblock does not leave applied true', () async {
    final reconciler = AsyncBoolReconciler();
    final blockStarted = Completer<void>();
    final allowBlockToFinish = Completer<void>();
    final applied = <bool>[];

    Future<void> apply(bool target) async {
      if (target) {
        blockStarted.complete();
        await allowBlockToFinish.future;
      }
      applied.add(target);
    }

    // Start block (slow).
    final blockFuture = reconciler.setDesired(true, apply);
    await blockStarted.future;

    // Request unblock while block JS is still in flight.
    final unblockFuture = reconciler.setDesired(false, apply);

    // Let the stale block complete; reconciler must continue to false.
    allowBlockToFinish.complete();
    await Future.wait([blockFuture, unblockFuture]);

    expect(reconciler.applied, isFalse);
    expect(applied, equals([true, false]));
  });

  test('markApplied forces a re-apply after DOM wipe', () async {
    final reconciler = AsyncBoolReconciler();
    final applied = <bool>[];

    Future<void> apply(bool target) async => applied.add(target);

    await reconciler.setDesired(true, apply);
    expect(reconciler.applied, isTrue);

    // Simulate page reload clearing the DOM while desire stays true.
    reconciler.applied = false;
    await reconciler.setDesired(true, apply);

    expect(applied, equals([true, true]));
    expect(reconciler.applied, isTrue);
  });
}
