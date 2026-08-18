import 'package:flutter_quill_editor/draft/draft_page_lifecycle.dart';

class _NoopDraftPageLifecycle implements DraftPageLifecycle {
  @override
  void Function() onHidden(void Function() handler) => () {};

  @override
  void setUnloadGuard(bool enabled) {}
}

DraftPageLifecycle createDraftPageLifecycle() => _NoopDraftPageLifecycle();
