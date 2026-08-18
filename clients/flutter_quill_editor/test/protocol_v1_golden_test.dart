import 'dart:convert';
import 'dart:io';

import 'package:flutter_quill_editor/protocol/codec.dart';
import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter_quill_editor/protocol/protocol_version.dart';
import 'package:flutter_test/flutter_test.dart';

/// Vendored copy of flutter_quill_editor `packages/protocol/fixtures/v1.json`.
///
/// Keep in sync when the richtext protocol package bumps fixtures.
File get _fixtureFile {
  // flutter test CWD is the package root (`app/`).
  return File('test/fixtures/richtext_protocol/v1.json');
}

Map<String, Object?> _asMap(Object? value) {
  return (value! as Map).map(
    (key, dynamic v) => MapEntry(key.toString(), v as Object?),
  );
}

/// Normalize JSON for stable equality (Map key order does not matter for
/// structural compare; we re-encode via decoded maps).
Object? _normalizeJson(Object? value) {
  if (value is Map) {
    final keys = value.keys.map((k) => k.toString()).toList()..sort();
    return <String, Object?>{
      for (final key in keys) key: _normalizeJson(value[key]),
    };
  }
  if (value is List) {
    return value.map(_normalizeJson).toList();
  }
  return value;
}

void main() {
  late Map<String, Object?> fixtures;

  setUpAll(() {
    final raw = _fixtureFile.readAsStringSync();
    fixtures = _asMap(jsonDecode(raw));
  });

  group('Protocol v1 golden fixtures', () {
    test('fixture file is present and versioned', () {
      expect(_fixtureFile.existsSync(), isTrue);
      expect(kRichTextProtocolVersion, 1);
    });

    test('decode every command fixture', () {
      final commands = fixtures['commands']! as List<dynamic>;
      expect(commands, isNotEmpty);

      for (final entry in commands) {
        final map = _asMap(entry);
        final encoded = jsonEncode(map);
        final result = decodeProtocolMessage(encoded);
        expect(
          result,
          isA<ProtocolParseSuccess<ProtocolMessage>>(),
          reason: 'Failed to decode command fixture: $encoded',
        );
        final message = (result as ProtocolParseSuccess<ProtocolMessage>).value;
        expect(message, isA<ProtocolCommand>());
        expect(message.version, kRichTextProtocolVersion);
        expect(message.kind, 'command');
      }
    });

    test('decode every event fixture', () {
      final events = fixtures['events']! as List<dynamic>;
      expect(events, isNotEmpty);

      for (final entry in events) {
        final map = _asMap(entry);
        final encoded = jsonEncode(map);
        final result = decodeProtocolMessage(encoded);
        expect(
          result,
          isA<ProtocolParseSuccess<ProtocolMessage>>(),
          reason: 'Failed to decode event fixture: $encoded',
        );
        final message = (result as ProtocolParseSuccess<ProtocolMessage>).value;
        expect(message, isA<ProtocolEvent>());
        expect(message.version, kRichTextProtocolVersion);
        expect(message.kind, 'event');
      }
    });

    test('decode every response fixture', () {
      final responses = fixtures['responses']! as List<dynamic>;
      expect(responses, isNotEmpty);

      for (final entry in responses) {
        final map = _asMap(entry);
        final encoded = jsonEncode(map);
        final result = decodeProtocolMessage(encoded);
        expect(
          result,
          isA<ProtocolParseSuccess<ProtocolMessage>>(),
          reason: 'Failed to decode response fixture: $encoded',
        );
        final message = (result as ProtocolParseSuccess<ProtocolMessage>).value;
        expect(message, isA<ProtocolResponse>());
        expect(message.version, kRichTextProtocolVersion);
        expect(message.kind, 'response');
      }
    });

    test('encode round-trip matches fixture JSON for all messages', () {
      for (final section in ['commands', 'events', 'responses']) {
        final list = fixtures[section]! as List<dynamic>;
        for (final entry in list) {
          final original = _asMap(entry);
          final encoded = jsonEncode(original);
          final decoded = decodeProtocolMessage(encoded);
          expect(decoded, isA<ProtocolParseSuccess<ProtocolMessage>>());
          final message = (decoded as ProtocolParseSuccess<ProtocolMessage>).value;

          final reencoded = encodeProtocolMessage(message);
          final reparsed = jsonDecode(reencoded);

          expect(
            _normalizeJson(reparsed),
            _normalizeJson(original),
            reason: 'Round-trip mismatch for $section: $encoded',
          );
        }
      }
    });

    test('representative typed encode matches fixture payloads', () {
      final setSnapshot = encodeProtocolMessage(
        SetSnapshotCommand(
          id: 'cmd-set-snapshot',
          snapshot: const RichTextSnapshot({
            'content': [
              {'insert': 'hello\n'},
            ],
          }),
        ),
      );
      expect(
        _normalizeJson(jsonDecode(setSnapshot)),
        _normalizeJson((fixtures['commands']! as List).first),
      );

      final ready = encodeProtocolMessage(
        ReadyEvent(protocolVersion: kRichTextProtocolVersion),
      );
      expect(
        _normalizeJson(jsonDecode(ready)),
        _normalizeJson((fixtures['events']! as List).first),
      );

      final failure = encodeProtocolMessage(
        const ProtocolFailureResponse(
          id: 'cmd-undo',
          error: ProtocolFailureError(
            code: ProtocolErrorCode.commandFailed,
            message: 'Command failed.',
            details: {'reason': 'test fixture'},
          ),
        ),
      );
      expect(
        _normalizeJson(jsonDecode(failure)),
        _normalizeJson((fixtures['responses']! as List).last),
      );
    });

    test('rejects invalid JSON and unsupported version', () {
      final badJson = decodeProtocolMessage('{not json');
      expect(badJson, isA<ProtocolParseFailure<ProtocolMessage>>());
      expect(
        (badJson as ProtocolParseFailure).error.code,
        ProtocolErrorCode.invalidJson,
      );

      final badVersion = decodeProtocolMessage(
        jsonEncode({
          'version': 99,
          'kind': 'command',
          'id': 'x',
          'type': 'undo',
          'payload': <String, Object?>{},
        }),
      );
      expect(badVersion, isA<ProtocolParseFailure<ProtocolMessage>>());
    });

    test('rejects missing required command fields', () {
      final missingId = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'type': 'undo',
          'payload': <String, Object?>{},
        }),
      );
      expect(missingId, isA<ProtocolParseFailure<ProtocolMessage>>());
    });

    test('validates snapshots in non-command containers with their own paths', () {
      final change = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'event',
          'type': 'change',
          'payload': {
            'snapshot': {
              'content': [
                {'insert': 'missing terminal newline'},
              ],
            },
          },
        }),
      );
      expect(change, isA<ProtocolParseFailure<ProtocolMessage>>());
      final changeIssues = (change as ProtocolParseFailure<ProtocolMessage>).error.issues;
      expect(
        changeIssues.map((issue) => issue.path),
        contains(r'$.payload.snapshot.content'),
      );
      expect(
        changeIssues.map((issue) => issue.path),
        isNot(contains(r'$.value.snapshot.content')),
      );

      final response = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'response',
          'id': 'get-snapshot',
          'type': 'get_snapshot',
          'ok': true,
          'value': {
            'snapshot': {
              'content': [
                {'insert': 'missing terminal newline'},
              ],
            },
          },
        }),
      );
      expect(response, isA<ProtocolParseFailure<ProtocolMessage>>());
      final responseIssues = (response as ProtocolParseFailure<ProtocolMessage>).error.issues;
      expect(
        responseIssues.map((issue) => issue.path),
        contains(r'$.value.snapshot.content'),
      );
    });

    test('deep-validates canonical snapshot operations and attributes', () {
      final result = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'id': 'canonical',
          'type': 'set_snapshot',
          'payload': {
            'snapshot': {
              'title': 'Draft',
              'size': 'medium',
              'theme': 'blue',
              'content': [
                {
                  'insert': 'hello',
                  'attributes': {
                    'bold': true,
                    'link': 'https://example.com/docs',
                  },
                },
                {
                  'insert': '\n',
                  'attributes': {'header': 1},
                },
                {
                  'insert': {'mention': 'user-1'},
                  'attributes': {'sign': '!', 'displayText': 'Alice'},
                },
                {
                  'insert': {'channel': 'channel-1'},
                  'attributes': {'displayText': 'general'},
                },
                {
                  'insert': {'emoji': 'party_parrot'},
                },
                {
                  'insert': {'divider': 'true'},
                },
                {
                  'insert': {'image': 'tgg-local-media://image-token'},
                  'attributes': {
                    'width': '640',
                    'height': '480',
                    'mimeType': 'image/webp',
                    'fileSize': 1024,
                  },
                },
                {
                  'insert': {'video': 'https://cdn.example/video.mp4'},
                  'attributes': {
                    'width': '1280',
                    'height': '720',
                    'mimeType': 'video/mp4',
                    'fileSize': 2048,
                    'poster': 'https://cdn.example/poster.jpg',
                    'duration': 12,
                  },
                },
                {'insert': '\n'},
              ],
            },
          },
        }),
      );
      expect(result, isA<ProtocolParseSuccess<ProtocolMessage>>());
    });

    test('rejects non-canonical snapshot operations and attributes', () {
      final invalidSnapshots = <Map<String, Object?>>[
        {
          'content': [
            {'insert': 'text'},
          ],
        },
        {
          'content': [
            {
              'insert': 'text\n',
              'attributes': {'bold': true},
            },
            {'insert': '\n'},
          ],
        },
        {
          'content': [
            {
              'insert': {'unknown': 'value'},
            },
            {'insert': '\n'},
          ],
        },
        {
          'content': [
            {
              'insert': {'mention': 'user-1'},
              'attributes': {
                'sign': '!',
                'displayText': 'Alice',
                'extra': true,
              },
            },
            {'insert': '\n'},
          ],
        },
        {
          'content': [
            {
              'insert': 'text',
              'attributes': {'header': 1, 'list': 'bullet'},
            },
            {'insert': '\n'},
          ],
        },
      ];

      for (final snapshot in invalidSnapshots) {
        final result = decodeProtocolMessage(
          jsonEncode({
            'version': 1,
            'kind': 'command',
            'id': 'invalid-snapshot',
            'type': 'set_snapshot',
            'payload': {'snapshot': snapshot},
          }),
        );
        expect(result, isA<ProtocolParseFailure<ProtocolMessage>>());
      }
    });

    test('supports typed content insertion commands', () {
      final commands = <ProtocolCommand>[
        InsertMentionCommand(
          id: 'mention',
          typedPayload: const InsertMentionPayload(
            id: 'user-1',
            sign: '!',
            displayText: 'Alice',
            selection: ProtocolSelection(start: 0, end: 2),
          ),
        ),
        InsertChannelCommand(
          id: 'channel',
          typedPayload: const InsertChannelPayload(
            id: 'channel-1',
            displayText: 'general',
          ),
        ),
        InsertImageCommand(
          id: 'image',
          typedPayload: const InsertImagePayload(
            src: 'tgg-local-media://image-token',
            width: '320',
            height: '240',
            mimeType: 'image/jpeg',
            fileSize: 10,
          ),
        ),
        InsertVideoCommand(
          id: 'video',
          typedPayload: const InsertVideoPayload(
            src: 'https://cdn.example/video.mp4',
            width: '640',
            height: '480',
            mimeType: 'video/mp4',
            fileSize: 20,
            poster: 'https://cdn.example/poster.jpg',
            duration: 5,
          ),
        ),
        InsertLinkCommand(
          id: 'link',
          typedPayload: const InsertLinkPayload(
            url: 'https://teamgaga.com',
            text: 'TeamGaga',
            selection: ProtocolSelection(start: 0, end: 2),
          ),
        ),
        InsertDividerCommand(
          id: 'divider',
          typedPayload: const InsertDividerPayload(),
        ),
      ];

      for (final command in commands) {
        final encoded = encodeProtocolMessage(command);
        final decoded = decodeProtocolMessage(encoded);
        expect(decoded, isA<ProtocolParseSuccess<ProtocolMessage>>());
        final parsed = (decoded as ProtocolParseSuccess<ProtocolMessage>).value;
        expect(parsed, isA<ProtocolCommand>());
        final parsedCommand = parsed as ProtocolCommand;
        expect(parsedCommand.type, command.type);
        expect(parsed.toJson(), command.toJson());
      }
    });

    test('validates optional insert selection and media fields', () {
      final valid = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'id': 'image',
          'type': 'insert_image',
          'payload': {
            'src': 'https://cdn.example/image.jpg',
            'width': '1',
            'height': '1',
            'mimeType': 'image/jpeg',
            'fileSize': 0,
            'selection': {'start': 1, 'end': 3},
          },
        }),
      );
      expect(valid, isA<ProtocolParseSuccess<ProtocolMessage>>());

      final minimalVideo = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'id': 'video-minimal',
          'type': 'insert_video',
          'payload': {
            'src': 'https://cdn.example/video.mp4',
            'width': '640',
            'height': '480',
            'mimeType': 'video/mp4',
            'fileSize': 1,
          },
        }),
      );
      expect(minimalVideo, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final minimalVideoCommand =
          (minimalVideo as ProtocolParseSuccess<ProtocolMessage>).value as InsertVideoCommand;
      expect(minimalVideoCommand.typedPayload.poster, isNull);
      expect(minimalVideoCommand.typedPayload.duration, isNull);
      expect(minimalVideoCommand.typedPayload.selection, isNull);

      final invalid = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'id': 'video',
          'type': 'insert_video',
          'payload': {
            'src': 'file:///tmp/video.mp4',
            'width': '01',
            'height': '480',
            'mimeType': 'video/mp4',
            'fileSize': -1,
            'duration': -2,
          },
        }),
      );
      expect(invalid, isA<ProtocolParseFailure<ProtocolMessage>>());
      final issues = (invalid as ProtocolParseFailure<ProtocolMessage>).error.issues;
      expect(issues.map((issue) => issue.path), contains(r'$.payload.src'));
      expect(issues.map((issue) => issue.path), contains(r'$.payload.width'));
      expect(issues.map((issue) => issue.path), contains(r'$.payload.fileSize'));
      expect(issues.map((issue) => issue.path), contains(r'$.payload.duration'));
    });

    test('validates link and divider insertion payloads', () {
      final invalidLink = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'id': 'link',
          'type': 'insert_link',
          'payload': {
            'url': 'javascript:alert(1)',
            'text': 'unsafe',
          },
        }),
      );
      expect(invalidLink, isA<ProtocolParseFailure<ProtocolMessage>>());
      final linkIssues = (invalidLink as ProtocolParseFailure<ProtocolMessage>).error.issues;
      expect(linkIssues.map((issue) => issue.path), contains(r'$.payload.url'));

      final invalidDivider = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'id': 'divider',
          'type': 'insert_divider',
          'payload': {'extra': true},
        }),
      );
      expect(invalidDivider, isA<ProtocolParseFailure<ProtocolMessage>>());
    });

    test('supports indent/outdent/get_caret_rect and request_link', () {
      for (final type in ['indent', 'outdent', 'get_caret_rect']) {
        final command = decodeProtocolMessage(
          jsonEncode({
            'version': 1,
            'kind': 'command',
            'id': 'cmd-$type',
            'type': type,
            'payload': <String, Object?>{},
          }),
        );
        expect(command, isA<ProtocolParseSuccess<ProtocolMessage>>());
      }

      final caretResponse = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'response',
          'id': 'cmd-get-caret-rect',
          'type': 'get_caret_rect',
          'ok': true,
          'value': {
            'rect': {'x': 12.5, 'y': 48, 'width': 0, 'height': 20},
          },
        }),
      );
      expect(caretResponse, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final success =
          (caretResponse as ProtocolParseSuccess<ProtocolMessage>).value as ProtocolSuccessResponse;
      expect(
        success.caretRectOrNull,
        const ProtocolCaretRect(x: 12.5, y: 48, width: 0, height: 20),
      );

      final nullCaret = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'response',
          'id': 'cmd-get-caret-rect',
          'type': 'get_caret_rect',
          'ok': true,
          'value': {'rect': null},
        }),
      );
      expect(nullCaret, isA<ProtocolParseSuccess<ProtocolMessage>>());
      expect(
        ((nullCaret as ProtocolParseSuccess<ProtocolMessage>).value as ProtocolSuccessResponse)
            .caretRectOrNull,
        isNull,
      );

      final requestLink = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'event',
          'type': 'request_link',
          'payload': {
            'selection': {'start': 0, 'end': 5},
          },
        }),
      );
      expect(requestLink, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final event =
          (requestLink as ProtocolParseSuccess<ProtocolMessage>).value as RequestLinkEvent;
      expect(event.selection, const ProtocolSelection(start: 0, end: 5));

      final emptyRequestLink = encodeProtocolMessage(RequestLinkEvent());
      expect(
        _normalizeJson(jsonDecode(emptyRequestLink)),
        _normalizeJson({
          'version': 1,
          'kind': 'event',
          'type': 'request_link',
          'payload': <String, Object?>{},
        }),
      );

      final invalidCaret = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'response',
          'id': 'cmd-get-caret-rect',
          'type': 'get_caret_rect',
          'ok': true,
          'value': {
            'rect': {'x': 1, 'y': 2, 'width': -1, 'height': 3},
          },
        }),
      );
      expect(invalidCaret, isA<ProtocolParseFailure<ProtocolMessage>>());
      final caretIssues = (invalidCaret as ProtocolParseFailure<ProtocolMessage>).error.issues;
      expect(caretIssues.map((issue) => issue.path), contains(r'$.value.rect.width'));
    });

    test('accepts integral JSON doubles and normalizes typed integer fields', () {
      final result = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'id': 'image-double',
          'type': 'insert_image',
          'payload': {
            'src': 'https://cdn.example/image.jpg',
            'width': '1',
            'height': '1',
            'mimeType': 'image/jpeg',
            'fileSize': 1.0,
            'selection': {'start': 1.0, 'end': 2.0},
          },
        }),
      );
      expect(result, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final command = (result as ProtocolParseSuccess<ProtocolMessage>).value as InsertImageCommand;
      expect(command.typedPayload.fileSize, 1);
      expect(command.typedPayload.fileSize, isA<int>());
      expect(command.typedPayload.selection, const ProtocolSelection(start: 1, end: 2));

      final video = decodeProtocolMessage(
        jsonEncode({
          'version': 1,
          'kind': 'command',
          'id': 'video-double',
          'type': 'insert_video',
          'payload': {
            'src': 'https://cdn.example/video.mp4',
            'width': '1',
            'height': '1',
            'mimeType': 'video/mp4',
            'fileSize': 1.0,
            'duration': 2.0,
          },
        }),
      );
      expect(video, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final videoCommand =
          (video as ProtocolParseSuccess<ProtocolMessage>).value as InsertVideoCommand;
      expect(videoCommand.typedPayload.fileSize, 1);
      expect(videoCommand.typedPayload.duration, 2);
      expect(videoCommand.typedPayload.duration, isA<int>());
    });

    test('rejects unsafe, negative, and fractional protocol integers', () {
      final invalidMessages = <Map<String, Object?>>[
        {
          'type': 'set_selection',
          'payload': {
            'selection': {'start': 9007199254740992, 'end': 9007199254740992},
          },
        },
        {
          'type': 'set_selection',
          'payload': {
            'selection': {'start': -1, 'end': 0},
          },
        },
        {
          'type': 'set_selection',
          'payload': {
            'selection': {'start': 1.5, 'end': 2},
          },
        },
        {
          'type': 'insert_image',
          'payload': {
            'src': 'https://cdn.example/image.jpg',
            'width': '1',
            'height': '1',
            'mimeType': 'image/jpeg',
            'fileSize': 9007199254740992,
          },
        },
        {
          'type': 'insert_image',
          'payload': {
            'src': 'https://cdn.example/image.jpg',
            'width': '1',
            'height': '1',
            'mimeType': 'image/jpeg',
            'fileSize': -1,
          },
        },
        {
          'type': 'insert_video',
          'payload': {
            'src': 'https://cdn.example/video.mp4',
            'width': '1',
            'height': '1',
            'mimeType': 'video/mp4',
            'fileSize': 1,
            'duration': 1.5,
          },
        },
      ];

      for (var index = 0; index < invalidMessages.length; index++) {
        final entry = invalidMessages[index];
        final result = decodeProtocolMessage(
          jsonEncode({
            'version': 1,
            'kind': 'command',
            'id': 'invalid-number-$index',
            'type': entry['type'],
            'payload': entry['payload'],
          }),
        );
        expect(result, isA<ProtocolParseFailure<ProtocolMessage>>());
      }
    });
  });
}
