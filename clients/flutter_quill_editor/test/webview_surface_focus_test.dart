import 'package:flutter_quill_editor/webview_surface_focus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Windows focuses nested plugin FocusNode, not the surface parent', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);

    final surface = FocusNode(debugLabel: 'surface');
    final plugin = FocusNode(debugLabel: 'plugin');
    addTearDown(surface.dispose);
    addTearDown(plugin.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Focus(
          focusNode: surface,
          canRequestFocus: false,
          child: Focus(
            focusNode: plugin,
            child: const SizedBox(width: 10, height: 10),
          ),
        ),
      ),
    );

    expect(firstFocusableFocusDescendant(surface), same(plugin));

    requestRichTextWebViewSurfaceFocus(surface);
    await tester.pump();

    expect(plugin.hasPrimaryFocus, isTrue);
    expect(surface.hasPrimaryFocus, isFalse);
    expect(surface.hasFocus, isTrue);

    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('macOS focuses the surface FocusNode itself', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);

    final surface = FocusNode(debugLabel: 'surface');
    final plugin = FocusNode(debugLabel: 'plugin');
    addTearDown(surface.dispose);
    addTearDown(plugin.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Focus(
          focusNode: surface,
          child: Focus(
            focusNode: plugin,
            child: const SizedBox(width: 10, height: 10),
          ),
        ),
      ),
    );

    requestRichTextWebViewSurfaceFocus(surface);
    await tester.pump();

    expect(surface.hasPrimaryFocus, isTrue);
    expect(plugin.hasPrimaryFocus, isFalse);

    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('restoreRichTextWebViewEditorFocus focuses Windows plugin then editor', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);

    final surface = FocusNode(debugLabel: 'surface');
    final plugin = FocusNode(debugLabel: 'plugin');
    addTearDown(surface.dispose);
    addTearDown(plugin.dispose);
    var editorFocused = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Focus(
          focusNode: surface,
          canRequestFocus: false,
          child: Focus(
            focusNode: plugin,
            child: const SizedBox(width: 10, height: 10),
          ),
        ),
      ),
    );

    final restore = restoreRichTextWebViewEditorFocus(
      surfaceFocusNode: surface,
      focusEditor: () async {
        editorFocused = true;
      },
    );
    await tester.pump(const Duration(milliseconds: 50));
    await restore;

    expect(plugin.hasPrimaryFocus, isTrue);
    expect(editorFocused, isTrue);

    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('richTextWebViewSurfaceHasFocus is true when nested Windows plugin is focused', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);

    final surface = FocusNode(debugLabel: 'surface');
    final plugin = FocusNode(debugLabel: 'plugin');
    addTearDown(surface.dispose);
    addTearDown(plugin.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Focus(
          focusNode: surface,
          canRequestFocus: false,
          child: Focus(
            focusNode: plugin,
            child: const SizedBox(width: 10, height: 10),
          ),
        ),
      ),
    );

    expect(richTextWebViewSurfaceHasFocus(surface), isFalse);
    plugin.requestFocus();
    await tester.pump();
    expect(surface.hasFocus, isTrue);
    expect(surface.hasPrimaryFocus, isFalse);
    expect(richTextWebViewSurfaceHasFocus(surface), isTrue);

    debugDefaultTargetPlatformOverride = null;
  });
}
