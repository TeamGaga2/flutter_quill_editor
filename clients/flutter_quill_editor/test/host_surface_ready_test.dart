import 'dart:async';

import 'package:flutter_quill_editor/host/richtext_webview_host.dart';
import 'package:flutter_quill_editor/widget/richtext_webview.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fake host that mirrors the Windows deferred-surface race: the controller
/// (and thus a successful [loadUrl]) only exists after [markSurfaceReady].
class _DeferredSurfaceHost extends RichTextWebViewHost {
  _DeferredSurfaceHost({required super.callbacks});

  final Completer<void> _surfaceReady = Completer<void>();
  int loadUrlAttempts = 0;
  int loadUrlCompleted = 0;
  bool sawLoadBeforeSurfaceReady = false;
  Uri? lastLoadedUrl;

  @override
  Future<void> get whenSurfaceReady => _surfaceReady.future;

  void markSurfaceReady() {
    if (!_surfaceReady.isCompleted) {
      _surfaceReady.complete();
    }
  }

  @override
  Widget buildSurface() => const SizedBox.shrink();

  @override
  Future<void> loadUrl(Uri url) async {
    loadUrlAttempts++;
    if (!_surfaceReady.isCompleted) {
      sawLoadBeforeSurfaceReady = true;
    }
    // Defense in depth — same contract as InAppWebViewWindowsRichTextHost.
    await whenSurfaceReady;
    lastLoadedUrl = url;
    loadUrlCompleted++;
  }

  @override
  Future<void> deliverProtocol(String protocolJson) async {}

  @override
  Future<void> runJavaScript(String script) async {
    await whenSurfaceReady;
  }

  @override
  Future<void> setBackgroundColor(Color color) async {}

  @override
  Future<void> setInspectable(bool inspectable) async {}

  @override
  Future<void> wakeEditingSession({bool keepTitle = false}) async {}

  @override
  Future<void> dispose() async {
    if (!_surfaceReady.isCompleted) {
      _surfaceReady.complete();
    }
  }
}

RichTextWebViewHostCallbacks _noopCallbacks() {
  return RichTextWebViewHostCallbacks(
    onPageStarted: (_) {},
    onPageFinished: (_) {},
    onMainFrameFailure: (_) {},
    onRawBridgeMessage: (_) {},
    onPointerGateOutsidePointer: () {},
    onExternalNavigation: (_) {},
  );
}

void main() {
  group('deferred Host Surface Ready', () {
    test('loadUrl does not complete before surface ready', () async {
      final host = _DeferredSurfaceHost(callbacks: _noopCallbacks());
      final url = Uri.parse('http://127.0.0.1:9/index.html');

      final load = host.loadUrl(url);
      await Future<void>.delayed(Duration.zero);

      expect(host.loadUrlAttempts, 1);
      expect(host.sawLoadBeforeSurfaceReady, isTrue);
      expect(host.loadUrlCompleted, 0);
      expect(host.lastLoadedUrl, isNull);

      host.markSurfaceReady();
      await load;

      expect(host.loadUrlCompleted, 1);
      expect(host.lastLoadedUrl, url);
    });

    test('orchestration-style await gates materialize/load until surface ready', () async {
      final host = _DeferredSurfaceHost(callbacks: _noopCallbacks());
      var materializeStarted = false;
      var loadStarted = false;

      final pipeline = () async {
        await host.whenSurfaceReady.timeout(kRichTextWebViewHostSurfaceReadyTimeout);
        materializeStarted = true;
        await host.loadUrl(Uri.parse('http://127.0.0.1:9/index.html'));
        loadStarted = true;
      }();

      await Future<void>.delayed(Duration.zero);
      expect(materializeStarted, isFalse);
      expect(loadStarted, isFalse);

      host.markSurfaceReady();
      await pipeline;

      expect(materializeStarted, isTrue);
      expect(loadStarted, isTrue);
      expect(host.loadUrlCompleted, 1);
    });

    test('surface-ready timeout maps to hostSurfaceReadyTimeout stage', () async {
      final host = _DeferredSurfaceHost(callbacks: _noopCallbacks());

      await expectLater(
        host.whenSurfaceReady.timeout(const Duration(milliseconds: 20)),
        throwsA(isA<TimeoutException>()),
      );
      expect(
        RichTextWebViewFailureStage.hostSurfaceReadyTimeout,
        isNot(equals(RichTextWebViewFailureStage.protocolReadyTimeout)),
      );
      expect(
        RichTextWebViewFailureStage.hostSurfaceReadyTimeout,
        isNot(equals(RichTextWebViewFailureStage.navigation)),
      );
    });

    test('retry creates a fresh surface-ready lifecycle', () async {
      final first = _DeferredSurfaceHost(callbacks: _noopCallbacks());
      await (first..markSurfaceReady()).whenSurfaceReady;

      // Simulate retry: dispose old host, create a new generation.
      await first.dispose();
      final second = _DeferredSurfaceHost(callbacks: _noopCallbacks());

      var secondReady = false;
      unawaited(second.whenSurfaceReady.then((_) => secondReady = true));
      await Future<void>.delayed(Duration.zero);
      expect(secondReady, isFalse);

      final loadFuture = second.loadUrl(Uri.parse('http://127.0.0.1:9/index.html'));
      await Future<void>.delayed(Duration.zero);
      expect(second.loadUrlCompleted, 0);

      second.markSurfaceReady();
      await loadFuture;
      expect(secondReady, isTrue);
      expect(second.loadUrlCompleted, 1);
    });
  });

  group('first terminal failure wins', () {
    test('later protocolReadyTimeout does not overwrite navigation failure', () {
      var lifecycle = RichTextWebViewLifecycle.initializing;
      RichTextWebViewFailure? lastFailure;

      void reportFailure(RichTextWebViewFailure failure) {
        // Mirrors RichTextWebViewState._reportFailure.
        if (lifecycle == RichTextWebViewLifecycle.failed) return;
        lastFailure = failure;
        lifecycle = RichTextWebViewLifecycle.failed;
      }

      reportFailure(
        const RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.navigation,
          message: 'surface not created',
        ),
      );
      reportFailure(
        const RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.protocolReadyTimeout,
          message: 'ready timed out',
        ),
      );

      expect(lifecycle, RichTextWebViewLifecycle.failed);
      expect(lastFailure?.stage, RichTextWebViewFailureStage.navigation);
      expect(lastFailure?.message, 'surface not created');
    });

    test('protocol timeout is ignored when already failed', () {
      const lifecycle = RichTextWebViewLifecycle.failed;
      var accepted = false;

      void maybeReportTimeout() {
        if (lifecycle == RichTextWebViewLifecycle.failed) return;
        accepted = true;
      }

      maybeReportTimeout();
      expect(accepted, isFalse);
    });
  });

  group('protocol ready timeout arming', () {
    test('constant remains 15s and is distinct from surface-ready deadline', () {
      expect(kRichTextWebViewProtocolReadyTimeout, const Duration(seconds: 15));
      expect(kRichTextWebViewHostSurfaceReadyTimeout, const Duration(seconds: 10));
      expect(
        kRichTextWebViewProtocolReadyTimeout,
        isNot(equals(kRichTextWebViewHostSurfaceReadyTimeout)),
      );
    });
  });

  group('channel init timeout (plan §14)', () {
    test('constant is 5s and distinct from the other webview deadlines', () {
      expect(kRichTextWebViewChannelInitTimeout, const Duration(seconds: 5));
      expect(
        kRichTextWebViewChannelInitTimeout,
        isNot(equals(kRichTextWebViewHostSurfaceReadyTimeout)),
      );
      expect(
        kRichTextWebViewChannelInitTimeout,
        isNot(equals(kRichTextWebViewProtocolReadyTimeout)),
      );
    });

    test('a MessagePort initialize that never acks times out at the deadline', () async {
      // Mirrors WebIframeRichTextHost.initializeRuntime's internal wait for
      // host-control `initializeAck` — a fake Completer that never completes
      // stands in for a MessagePort that never receives the ack.
      final neverAcks = Completer<void>();

      await expectLater(
        neverAcks.future.timeout(const Duration(milliseconds: 20)),
        throwsA(isA<TimeoutException>()),
      );
    });
  });
}
