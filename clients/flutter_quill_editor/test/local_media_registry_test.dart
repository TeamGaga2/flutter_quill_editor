import 'dart:typed_data';

import 'package:flutter_quill_editor/media/local_media_registry.dart';
import 'package:flutter_quill_editor/media/web_draft_media_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reuses a token for a path and updates its mime type', () {
    final registry = LocalMediaRegistry(
      tokenGenerator: () => '00000000-0000-4000-8000-000000000001',
      draftMediaStore: MemoryWebDraftMediaStore(),
    );

    final first = registry.registerPath('/tmp/photo', mimeType: 'image/jpeg');
    final second = registry.registerPath('/tmp/photo', mimeType: 'image/png');

    expect(first, second);
    expect(registry.length, 1);
    expect(registry.lookup(first)?.mimeType, 'image/png');
    expect(registry.pathForToken(first), '/tmp/photo');
  });

  test('does not accept path-derived or malformed tokens', () {
    final registry = LocalMediaRegistry(
      tokenGenerator: () => '00000000-0000-4000-8000-000000000002',
      draftMediaStore: MemoryWebDraftMediaStore(),
    );
    final uri = registry.registerPath('/tmp/photo');

    expect(registry.lookup('photo'), isNull);
    expect(registry.lookup('$uri/extra'), isNull);
    expect(registry.lookup('tgg-local-media://photo'), isNull);
  });

  test('clear removes both indexes', () {
    final registry = LocalMediaRegistry(
      tokenGenerator: () => '00000000-0000-4000-8000-000000000003',
      draftMediaStore: MemoryWebDraftMediaStore(),
    );
    final uri = registry.registerPath('/tmp/photo');

    registry.clear();

    expect(registry.length, 0);
    expect(registry.lookup(uri), isNull);
    expect(registry.registerPath('/tmp/photo'), uri);
  });

  test('registerBlob persists bytes before returning a token URI', () async {
    final store = MemoryWebDraftMediaStore();
    final registered = <(String, String, String?)>[];
    var tokenIndex = 0;
    final tokens = <String>[
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
    ];
    final registry = MediaResourceRegistry(
      tokenGenerator: () => tokens[tokenIndex++],
      draftMediaStore: store,
      onRegisterObjectUrl: (token, objectUrl, mimeType) async {
        registered.add((token, objectUrl, mimeType));
      },
    );

    final uri = await registry.registerBlob(
      draftKey: 'draft-1',
      bytes: Uint8List.fromList([1, 2, 3]),
      mimeType: 'image/png',
      fileName: 'a.png',
    );

    expect(uri, 'tgg-local-media://${tokens[0]}');
    expect(registry.objectUrlForToken(uri), isNotNull);
    expect(await registry.readBytes(uri), Uint8List.fromList([1, 2, 3]));
    expect(registered, hasLength(1));
    expect(registered.single.$1, tokens[0]);
    expect(await store.get('draft-1', tokens[0]), isNotNull);
  });

  test('registerBlob rolls back when host registration fails', () async {
    final store = MemoryWebDraftMediaStore();
    final registry = MediaResourceRegistry(
      tokenGenerator: () => '00000000-0000-4000-8000-000000000020',
      draftMediaStore: store,
      onRegisterObjectUrl: (token, objectUrl, mimeType) async {
        throw StateError('host down');
      },
    );

    await expectLater(
      () => registry.registerBlob(
        draftKey: 'draft-1',
        bytes: Uint8List.fromList([9]),
        mimeType: 'image/jpeg',
      ),
      throwsStateError,
    );
    expect(registry.length, 0);
    expect(await store.get('draft-1', '00000000-0000-4000-8000-000000000020'), isNull);
  });

  test('restoreDraft rebuilds object URLs from the store', () async {
    final store = MemoryWebDraftMediaStore();
    const token = '00000000-0000-4000-8000-000000000030';
    await store.put(
      WebDraftMediaRecord(
        draftKey: 'draft-1',
        token: token,
        bytes: Uint8List.fromList([4, 5]),
        mimeType: 'image/webp',
        fileSize: 2,
        createdAt: DateTime.utc(2026),
        fileName: 'b.webp',
      ),
    );

    final registered = <String>[];
    final registry = MediaResourceRegistry(
      tokenGenerator: () => '00000000-0000-4000-8000-000000000031',
      draftMediaStore: store,
      onRegisterObjectUrl: (t, objectUrl, mimeType) async {
        registered.add(t);
      },
    );

    await registry.restoreDraft(draftKey: 'draft-1', tokens: [token]);
    expect(registry.contains(token), isTrue);
    expect(await registry.readBytes(token), Uint8List.fromList([4, 5]));
    expect(registered, [token]);
  });

  test('fails instead of looping forever when token generation collides', () {
    final registry = LocalMediaRegistry(
      tokenGenerator: () => '00000000-0000-4000-8000-000000000004',
      draftMediaStore: MemoryWebDraftMediaStore(),
    )..registerPath('/tmp/first');

    expect(
      () => registry.registerPath('/tmp/second'),
      throwsA(isA<StateError>()),
    );
  });

  test('rebindObjectUrls recreates object URLs and re-registers with the host', () async {
    final store = MemoryWebDraftMediaStore();
    final registered = <String>[];
    final registry = MediaResourceRegistry(
      tokenGenerator: () => '00000000-0000-4000-8000-000000000040',
      draftMediaStore: store,
      onRegisterObjectUrl: (t, objectUrl, mimeType) async {
        registered.add('$t:$objectUrl');
      },
    );

    final uri = await registry.registerBlob(
      draftKey: 'draft-1',
      bytes: Uint8List.fromList([7, 8]),
      mimeType: 'image/gif',
    );
    expect(registered, hasLength(1));
    final firstUrl = registry.objectUrlForToken(uri);

    await registry.rebindObjectUrls(tokens: [uri]);
    expect(registered, hasLength(2));
    expect(registry.objectUrlForToken(uri), isNot(firstUrl));
    expect(await registry.readBytes(uri), Uint8List.fromList([7, 8]));
  });
}
