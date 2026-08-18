import 'package:flutter_quill_editor/host/bridge_capability.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BridgeCapability', () {
    test('generates non-empty, distinct token and nonce', () {
      final capability = BridgeCapability();

      expect(capability.token, isNotEmpty);
      expect(capability.nonce, isNotEmpty);
      expect(capability.token, isNot(equals(capability.nonce)));
    });

    test('rotation mints a different token and nonce each time', () {
      final first = BridgeCapability();
      final second = BridgeCapability();

      expect(first.token, isNot(equals(second.token)));
      expect(first.nonce, isNot(equals(second.nonce)));
    });

    test('decodeAndValidate accepts a correctly-encoded envelope', () {
      final capability = BridgeCapability();
      final envelope = capability.encodeEnvelope('{"type":"ready"}');

      final payload = capability.decodeAndValidate(envelope);

      expect(payload, '{"type":"ready"}');
    });

    test('decodeAndValidate rejects a wrong token', () {
      final capability = BridgeCapability();
      final impostor = BridgeCapability();
      final envelope = impostor.encodeEnvelope('{"type":"ready"}');

      expect(capability.decodeAndValidate(envelope), isNull);
    });

    test('decodeAndValidate rejects a missing token field', () {
      final capability = BridgeCapability();

      expect(capability.decodeAndValidate('{"v":1,"p":"{}"}'), isNull);
    });

    test('decodeAndValidate rejects malformed JSON', () {
      final capability = BridgeCapability();

      expect(capability.decodeAndValidate('not json'), isNull);
      expect(capability.decodeAndValidate(''), isNull);
    });

    test('decodeAndValidate rejects an unsupported envelope version', () {
      final capability = BridgeCapability();
      final wrongVersion = '{"v":2,"t":"${capability.token}","p":"{}"}';

      expect(capability.decodeAndValidate(wrongVersion), isNull);
    });

    test('decodeAndValidate rejects a non-string payload', () {
      final capability = BridgeCapability();
      final badPayload = '{"v":1,"t":"${capability.token}","p":123}';

      expect(capability.decodeAndValidate(badPayload), isNull);
    });

    test('a rotated capability no longer validates envelopes from the old one', () {
      final original = BridgeCapability();
      final envelope = original.encodeEnvelope('{"type":"change"}');

      final rotated = BridgeCapability();

      expect(rotated.decodeAndValidate(envelope), isNull);
      // The original capability still works — rotation creates a new
      // instance, it does not mutate the old one out from under callers.
      expect(original.decodeAndValidate(envelope), '{"type":"change"}');
    });
  });
}
