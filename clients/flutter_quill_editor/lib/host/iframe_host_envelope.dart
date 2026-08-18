/// Handshake + host-envelope constants shared with flutter_quill_editor
/// (`iframe-handshake.ts` / `host-envelope.ts`).
library;

const String kIframeHandshakeNamespace = 'tg.richtext.iframe.handshake';
const int kIframeHandshakeVersion = 1;
const String kHostEnvelopeNamespace = 'tg.richtext.host';
const int kHostEnvelopeVersion = 1;

bool isSurfaceReadyHandshake(Map<String, dynamic> data) {
  return data['namespace'] == kIframeHandshakeNamespace &&
      data['version'] == kIframeHandshakeVersion &&
      data['type'] == 'surfaceReady' &&
      data['protocolVersion'] is int &&
      data['hostEnvelopeVersion'] is int &&
      data['buildId'] is String;
}

Map<String, Object?> encodeInitializeHandshake({
  required String token,
  required Map<String, Object?> config,
}) {
  return <String, Object?>{
    'namespace': kIframeHandshakeNamespace,
    'version': kIframeHandshakeVersion,
    'type': 'initialize',
    'token': token,
    'config': config,
  };
}

Map<String, Object?> encodeProtocolEnvelope({
  required String token,
  required String protocolJson,
}) {
  return <String, Object?>{
    'namespace': kHostEnvelopeNamespace,
    'version': kHostEnvelopeVersion,
    'plane': 'protocol',
    'token': token,
    'payload': protocolJson,
  };
}

Map<String, Object?> encodeHostControlEnvelope({
  required String token,
  required Map<String, Object?> operation,
}) {
  return <String, Object?>{
    'namespace': kHostEnvelopeNamespace,
    'version': kHostEnvelopeVersion,
    'plane': 'host-control',
    'token': token,
    'payload': operation,
  };
}
