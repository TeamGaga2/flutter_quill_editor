/// Serializes async application of a boolean so out-of-order completions cannot
/// leave a stale `true` after a later `false` was requested.
///
/// Used by desktop WebView pointer-gate DOM sync: a slow "install blocker"
/// must never land after "remove blocker", or the editor stays unclickable.
class AsyncBoolReconciler {
  /// Last successfully applied value. Set to `false` after a DOM wipe (page
  /// reload) so the next [setDesired] re-applies from scratch.
  bool applied = false;

  var _desired = false;
  var _inFlight = false;

  Future<void> setDesired(
    bool value,
    Future<void> Function(bool target) apply,
  ) async {
    _desired = value;
    if (_inFlight) {
      // Join the in-flight loop; when it finishes, re-enter if desire drifted.
      while (_inFlight) {
        await Future<void>.delayed(Duration.zero);
      }
      if (applied != _desired) {
        await setDesired(_desired, apply);
      }
      return;
    }

    _inFlight = true;
    try {
      while (applied != _desired) {
        final target = _desired;
        await apply(target);
        applied = target;
      }
    } finally {
      _inFlight = false;
    }
  }
}
