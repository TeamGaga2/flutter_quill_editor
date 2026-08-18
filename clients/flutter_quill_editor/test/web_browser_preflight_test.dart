import 'package:flutter_quill_editor/host/web_browser_preflight.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VM stub preflight succeeds', () async {
    final result = await runWebBrowserPreflight();
    expect(result.ok, isTrue);
    expect(result.reason, isNull);
  });
}
