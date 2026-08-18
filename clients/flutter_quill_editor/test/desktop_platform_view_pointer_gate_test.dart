import 'package:flutter_quill_editor/desktop_platform_view_pointer_gate.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    final gate = DesktopPlatformViewPointerGate.instance;
    while (gate.blocked.value) {
      gate.release();
    }
  });

  test('acquire/release uses depth and toggles blocked on desktop', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final gate = DesktopPlatformViewPointerGate.instance;

    expect(gate.blocked.value, isFalse);

    gate.acquire();
    expect(gate.blocked.value, isTrue);
    expect(gate.focusBlocked.value, isTrue);

    gate.acquire();
    expect(gate.blocked.value, isTrue);

    gate.release();
    expect(gate.blocked.value, isTrue);

    gate.release();
    expect(gate.blocked.value, isFalse);
    expect(gate.focusBlocked.value, isFalse);
  });

  test('pointer-only lease preserves editor focus and composes with dialogs', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final gate = DesktopPlatformViewPointerGate.instance..acquire(blockFocus: false);
    expect(gate.blocked.value, isTrue);
    expect(gate.focusBlocked.value, isFalse);

    gate.acquire();
    expect(gate.blocked.value, isTrue);
    expect(gate.focusBlocked.value, isTrue);

    gate.release();
    expect(gate.blocked.value, isTrue);
    expect(gate.focusBlocked.value, isFalse);

    gate.release(blockFocus: false);
    expect(gate.blocked.value, isFalse);
    expect(gate.focusBlocked.value, isFalse);
  });

  test('extra release is a no-op', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final gate = DesktopPlatformViewPointerGate.instance;

    expect(gate.blocked.value, isFalse);
    gate.release();
    expect(gate.blocked.value, isFalse);

    gate
      ..acquire()
      ..release()
      ..release();
    expect(gate.blocked.value, isFalse);
  });

  test('does nothing on non-desktop platforms', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final gate = DesktopPlatformViewPointerGate.instance;

    expect(gate.blocked.value, isFalse);
    gate.acquire();
    expect(gate.blocked.value, isFalse);
    gate.release();
    expect(gate.blocked.value, isFalse);
  });

  test('outside pointer notifies registered listeners while blocked', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final gate = DesktopPlatformViewPointerGate.instance;
    var calls = 0;
    void listener() => calls += 1;

    gate
      ..addOutsidePointerListener(listener)
      ..notifyOutsidePointer();
    expect(calls, 0);

    gate
      ..acquire()
      ..notifyOutsidePointer();
    expect(calls, 1);

    gate
      ..removeOutsidePointerListener(listener)
      ..notifyOutsidePointer();
    expect(calls, 1);

    gate.release();
  });

  test('outside pointer listener can dismiss and release during notify', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final gate = DesktopPlatformViewPointerGate.instance;
    var calls = 0;

    void listener() {
      calls += 1;
      gate
        ..removeOutsidePointerListener(listener)
        ..release();
    }

    gate
      ..acquire()
      ..addOutsidePointerListener(listener)
      ..notifyOutsidePointer();

    expect(calls, 1);
    expect(gate.blocked.value, isFalse);
  });

  test('reapply does not briefly clear blocked while an overlay is open', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final gate = DesktopPlatformViewPointerGate.instance;
    final values = <bool>[];
    void listener() => values.add(gate.blocked.value);

    gate.blocked.addListener(listener);
    gate.acquire();
    values.clear();

    gate.reapply();
    expect(gate.blocked.value, isTrue);
    expect(values, isEmpty);

    gate.release();
    values.clear();
    gate.reapply();
    expect(gate.blocked.value, isFalse);
    expect(values, <bool>[true, false]);

    gate.blocked.removeListener(listener);
  });
}
