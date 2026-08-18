import 'dart:convert';
import 'dart:math';

/// Envelope schema version for [BridgeCapability.encodeEnvelope].
const int kBridgeCapabilityEnvelopeVersion = 1;

/// One-shot secure capability used to authenticate Web → Flutter bridge
/// messages for a single [RichTextWebViewHost] generation.
///
/// The stable `flutter_inappwebview` 6.1.5 JavaScript handler callback does
/// not provide reliable origin / main-frame metadata (see plan §5.5), so the
/// host cannot trust a message's origin from platform APIs alone. Instead:
///
/// - Each host generation mints a random [token] (never logged, never
///   persisted, never part of the business protocol).
/// - The token is baked into the materialized HTML's bridge shim closure.
/// - Every Web → Flutter message must carry the token in an envelope
///   `{v:1,t:token,p:protocolJsonString}`; [decodeAndValidate] rejects
///   anything else.
/// - `retry()` mints a brand-new [BridgeCapability] (rotated token + nonce);
///   the old token stops validating immediately.
class BridgeCapability {
  BridgeCapability({String? token, String? nonce})
    : token = token ?? _generateSecureRandomToken(32),
      nonce = nonce ?? _generateSecureRandomToken(16);

  /// One-shot secret proving a bridge message originated from the runtime
  /// this host materialized (not an arbitrary origin).
  final String token;

  /// CSP `script-src` nonce for this host generation's inline scripts.
  final String nonce;

  /// Wraps [protocolJson] (an already-encoded protocol message string) in the
  /// capability envelope for the Web → Flutter direction.
  String encodeEnvelope(String protocolJson) {
    return jsonEncode(<String, Object?>{
      'v': kBridgeCapabilityEnvelopeVersion,
      't': token,
      'p': protocolJson,
    });
  }

  /// Decodes [raw] and returns the inner protocol JSON string when — and
  /// only when — the envelope is well-formed and [token] matches exactly.
  ///
  /// Returns `null` for missing/malformed/wrong-token input. Callers must
  /// not log the raw envelope (it may contain the token) beyond debug-only
  /// diagnostics without the token itself.
  String? decodeAndValidate(String raw) {
    final Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on Object {
      return null;
    }
    if (decoded is! Map) return null;
    if (decoded['v'] != kBridgeCapabilityEnvelopeVersion) return null;
    final candidateToken = decoded['t'];
    if (candidateToken is! String || candidateToken != token) return null;
    final payload = decoded['p'];
    if (payload is! String) return null;
    return payload;
  }

  static String _generateSecureRandomToken(int byteLength) {
    final random = Random.secure();
    final bytes = List<int>.generate(byteLength, (_) => random.nextInt(256));
    // Base64Url without padding: safe to embed in a JS string literal and a
    // CSP nonce attribute without extra escaping.
    return base64Url.encode(bytes).replaceAll('=', '');
  }
}
