import 'dart:convert';

/// Emoji surface definition injected by the host app.
///
/// [id] is the runtime emoji id consumed by `insert_emoji`; [assetPath] is
/// the Flutter asset path of the PNG — the hosting app must declare it in
/// its own pubspec (the package ships no emoji artwork).
class RichTextEmojiDefinition {
  const RichTextEmojiDefinition({required this.id, required this.assetPath});

  final String id;
  final String assetPath;
}

/// Builds the JS snippet that registers emoji image URLs for the WebView host.
///
/// Paths are absolute from the local runtime HTTP root:
/// `GET /images/emoji/{id}.png` → Flutter-copied asset files.
String buildEmojiDefinitionsBootstrapJs({
  required List<RichTextEmojiDefinition> definitions,
}) {
  final defs = <Map<String, String>>[
    for (final definition in definitions)
      if (definition.id.isNotEmpty)
        <String, String>{
          'id': definition.id,
          'src': '/images/emoji/${definition.id}.png',
        },
  ];
  final json = jsonEncode(defs);
  return 'window.__TG_RICHTEXT_EMOJI_DEFINITIONS__=$json;';
}

/// Flutter asset keys for emoji PNGs.
List<String> emojiFlutterAssetKeys(List<RichTextEmojiDefinition> definitions) {
  return [
    for (final definition in definitions)
      if (definition.id.isNotEmpty) definition.assetPath,
  ];
}
