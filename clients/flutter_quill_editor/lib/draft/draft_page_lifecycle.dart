import 'package:flutter_quill_editor/draft/draft_page_lifecycle_stub.dart'
    if (dart.library.html) 'package:flutter_quill_editor/draft/draft_page_lifecycle_web.dart'
    as impl;

/// Browser page lifecycle hooks for draft flush (ADR-0015).
abstract class DraftPageLifecycle {
  /// Subscribe to visibility hidden / pagehide. Returns an unsubscribe.
  void Function() onHidden(void Function() handler);

  /// Register/unregister a dirty-only beforeunload guard.
  void setUnloadGuard(bool enabled);
}

DraftPageLifecycle createDraftPageLifecycle() => impl.createDraftPageLifecycle();
