import 'dart:js_interop';

import 'package:flutter_quill_editor/draft/draft_page_lifecycle.dart';
import 'package:web/web.dart' as web;

class _WebDraftPageLifecycle implements DraftPageLifecycle {
  web.EventListener? _visibilityListener;
  web.EventListener? _pageHideListener;
  web.EventListener? _beforeUnloadListener;

  @override
  void Function() onHidden(void Function() handler) {
    void fire() => handler();

    final visibilityListener = ((web.Event _) {
      if (web.document.visibilityState == 'hidden') {
        fire();
      }
    }).toJS;
    final pageHideListener = ((web.Event _) => fire()).toJS;
    _visibilityListener = visibilityListener;
    _pageHideListener = pageHideListener;

    web.document.addEventListener('visibilitychange', visibilityListener);
    web.window.addEventListener('pagehide', pageHideListener);

    return () {
      final visibility = _visibilityListener;
      final pageHide = _pageHideListener;
      if (visibility != null) {
        web.document.removeEventListener('visibilitychange', visibility);
      }
      if (pageHide != null) {
        web.window.removeEventListener('pagehide', pageHide);
      }
      _visibilityListener = null;
      _pageHideListener = null;
    };
  }

  @override
  void setUnloadGuard(bool enabled) {
    if (!enabled) {
      final listener = _beforeUnloadListener;
      if (listener != null) {
        web.window.removeEventListener('beforeunload', listener);
        _beforeUnloadListener = null;
      }
      return;
    }
    if (_beforeUnloadListener != null) return;
    final listener = ((web.Event event) {
      // Standard un-saved-changes guard — never carries draft content, only
      // the browser-native "leave site?" prompt while dirty/in-flight.
      event.preventDefault();
      (event as web.BeforeUnloadEvent).returnValue = '';
    }).toJS;
    _beforeUnloadListener = listener;
    web.window.addEventListener('beforeunload', listener);
  }
}

DraftPageLifecycle createDraftPageLifecycle() => _WebDraftPageLifecycle();
