import 'dart:async';

import 'package:flutter_quill_editor/draft/draft_page_lifecycle.dart';
import 'package:flutter_quill_editor/draft/draft_writer.dart';
import 'package:clock/clock.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeLifecycle implements DraftPageLifecycle {
  void Function()? hiddenHandler;
  final List<bool> guardCalls = <bool>[];

  @override
  void Function() onHidden(void Function() handler) {
    hiddenHandler = handler;
    return () => hiddenHandler = null;
  }

  @override
  void setUnloadGuard(bool enabled) => guardCalls.add(enabled);
}

void main() {
  test('coalesces rapid writes within ~250ms into one latest-wins persist', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final persisted = <String?>[];
        final writer = DraftWriter(persist: (p) async => persisted.add(p));
        final enqueue = writer.write;

        enqueue(() => 'v1');
        async.elapse(const Duration(milliseconds: 100));
        enqueue(() => 'v2');
        async.elapse(const Duration(milliseconds: 100));
        enqueue(() => 'v3');
        // Bounded from the first write() (t=0): fires at t=250, not t=450.
        async
          ..elapse(const Duration(milliseconds: 60))
          ..flushMicrotasks();

        expect(persisted, ['v3']);
      });
    });
  });

  test('a payload builder runs lazily exactly once per coalesced batch', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        var buildCount = 0;
        final persisted = <String?>[];
        final writer = DraftWriter(persist: (p) async => persisted.add(p));
        final enqueue = writer.write;

        for (var i = 0; i < 5; i++) {
          enqueue(() {
            buildCount++;
            return 'v$i';
          });
        }
        async
          ..elapse(const Duration(milliseconds: 250))
          ..flushMicrotasks();

        expect(buildCount, 1);
        expect(persisted, ['v4']);
      });
    });
  });

  test('flush writes immediately without waiting for the coalesce window', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final persisted = <String?>[];
        final writer = DraftWriter(persist: (p) async => persisted.add(p));

        final enqueue = writer.write;
        enqueue(() => 'now');
        expect(persisted, isEmpty);
        unawaited(writer.flush());
        async.flushMicrotasks();

        expect(persisted, ['now']);
      });
    });
  });

  test('flush is a no-op when nothing is pending', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final persisted = <String?>[];
        final writer = DraftWriter(persist: (p) async => persisted.add(p));

        unawaited(writer.flush());
        async.flushMicrotasks();

        expect(persisted, isEmpty);
      });
    });
  });

  test('cancel drops the pending write instead of persisting it', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final persisted = <String?>[];
        final writer = DraftWriter(persist: (p) async => persisted.add(p));

        final enqueue = writer.write;
        enqueue(() => 'dropped');
        writer.cancel();
        async
          ..elapse(const Duration(milliseconds: 300))
          ..flushMicrotasks();

        expect(persisted, isEmpty);
      });
    });
  });

  test('a null payload persists as a remove', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final persisted = <String?>[];
        final writer = DraftWriter(persist: (p) async => persisted.add(p));
        final enqueue = writer.write;

        enqueue(() => null);
        async
          ..elapse(const Duration(milliseconds: 250))
          ..flushMicrotasks();

        expect(persisted, [null]);
      });
    });
  });

  test('a throwing builder is swallowed; the next write still persists', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final persisted = <String?>[];
        final writer = DraftWriter(persist: (p) async => persisted.add(p));
        final enqueue = writer.write;

        enqueue(() => throw StateError('media not resolvable yet'));
        async
          ..elapse(const Duration(milliseconds: 250))
          ..flushMicrotasks();
        expect(persisted, isEmpty);

        enqueue(() => 'ok');
        async
          ..elapse(const Duration(milliseconds: 250))
          ..flushMicrotasks();
        expect(persisted, ['ok']);
      });
    });
  });

  test('a write that lands mid-flight is queued and drained right after (serial)', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final persisted = <String?>[];
        final gate = Completer<void>();
        var firstCall = true;
        final writer = DraftWriter(
          persist: (p) async {
            if (firstCall) {
              firstCall = false;
              await gate.future;
            }
            persisted.add(p);
          },
        );
        final enqueue = writer.write;

        enqueue(() => 'first');
        async
          ..elapse(const Duration(milliseconds: 250))
          ..flushMicrotasks();
        expect(persisted, isEmpty, reason: 'first write is still in flight behind the gate');

        enqueue(() => 'second');
        gate.complete();
        async.flushMicrotasks();

        expect(persisted, ['first', 'second']);
      });
    });
  });

  test('arms the beforeunload guard only while dirty/in-flight', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final lifecycle = _FakeLifecycle();
        final writer = DraftWriter(
          persist: (p) async {},
          lifecycle: lifecycle,
        );
        final enqueue = writer.write;

        enqueue(() => 'x');
        expect(lifecycle.guardCalls.last, isTrue);
        expect(writer.isDirty, isTrue);

        async
          ..elapse(const Duration(milliseconds: 250))
          ..flushMicrotasks();

        expect(lifecycle.guardCalls.last, isFalse);
        expect(writer.isDirty, isFalse);
      });
    });
  });

  test('visibility hidden / pagehide hook triggers an immediate flush', () {
    fakeAsync((async) {
      withClock(Clock(() => async.getClock(DateTime.utc(2020)).now()), () {
        final persisted = <String?>[];
        final lifecycle = _FakeLifecycle();
        final writer = DraftWriter(
          persist: (p) async => persisted.add(p),
          lifecycle: lifecycle,
        );
        final enqueue = writer.write;

        enqueue(() => 'y');
        lifecycle.hiddenHandler?.call();
        async.flushMicrotasks();

        expect(persisted, ['y']);
      });
    });
  });
}
