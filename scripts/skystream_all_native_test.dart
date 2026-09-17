// Recorded live HTTP responses, real SkyStream JavaScriptCore/DOM/models.
// Opt-in: SKYSTREAM_PLUGIN_ROOT and SKYSTREAM_CASES_FILE are required.
@Timeout(Duration(minutes: 6))
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:skystream/core/domain/entity/multimedia_item.dart';
import 'package:skystream/core/extensions/engine/js_engine_worker.dart';

void main() {
  final root = Platform.environment['SKYSTREAM_PLUGIN_ROOT'];
  final file = Platform.environment['SKYSTREAM_CASES_FILE'];
  if (root == null || file == null) {
    test(
      'native provider validation requires live case file',
      () {},
      skip: true,
    );
    return;
  }
  final data = jsonDecode(File(file).readAsStringSync()) as Map;
  final cases = data['cases'] as List;
  final catalog =
      jsonDecode(File('$root/dist/plugins.json').readAsStringSync()) as List;
  for (final manifest in catalog) {
    final selected = cases
        .where((c) => c['provider'] == manifest['name'])
        .toList();
    if (selected.isEmpty) continue;
    test('${manifest['name']} callbacks in native SkyStream worker', () async {
      final zip = ZipDecoder().decodeBytes(
        File('$root/dist/${manifest['packageName']}.sky').readAsBytesSync(),
      );
      final script = utf8.decode(zip.findFile('plugin.js')!.content);
      final harness = Harness()
        ..provider = manifest['name'] as String
        ..fixtures = data['fixtures'] as List;
      addTearDown(harness.dispose);
      await harness.load(
        '(function(){const manifest=${jsonEncode(manifest)}; $script\n globalThis.port={getHome,search,load,loadStreams};})();',
      );
      for (final entry in selected) {
        final result = await harness.invoke(
          entry['method'] as String,
          List<Object?>.from(entry['args'] as List),
        ) as Map;
        expect(
          result['success'],
          entry['success'],
          reason: '${entry['method']}: ${result['message']}',
        );
        if (result['success'] != true) continue;
        final body = result['data'];
        if (entry['count'] != null)
          expect((body as List).length, entry['count']);
        if (entry['method'] == 'load') {
          final item = MultimediaItem.fromJson(
            Map<String, dynamic>.from(body as Map),
          );
          expect(item.title, isNotEmpty);
          expect(item.url, isNotEmpty);
        }
        if (entry['method'] == 'loadStreams')
          for (final s in body as List) {
            final stream = StreamResult.fromJson(
              Map<String, dynamic>.from(s as Map),
            );
            expect(stream.url, startsWith('http'));
          }
      }
    });
  }
}

class Harness {
  Harness() {
    runner = JsWorkerRunner(rx.sendPort);
    rx.listen((dynamic value) async {
      final msg = Map<Object?, Object?>.from(value as Map);
      if (msg['ch'] == 'http_request') {
        final args = jsonDecode(msg['aj'] as String) as Map<String, dynamic>;
        final response = await request(args);
        runner.handle({
          'br': 1,
          'bid': msg['bid'],
          'jsId': args['id'],
          'rv': response,
          'err': false,
        });
      } else {
        messages.add(msg);
      }
    });
  }
  late String provider;
  late List<dynamic> fixtures;
  Future<Map<String, dynamic>> request(Map<String, dynamic> args) async {
    final matches = fixtures.where(
      (entry) =>
          entry['provider'] == provider &&
          entry['method'] == args['method'] &&
          entry['url'] == args['url'] &&
          entry['body'] == args['body'],
    );
    if (matches.isEmpty)
      return {
        'status': 599,
        'body': 'Missing recorded response',
        'headers': {},
      };
    return Map<String, dynamic>.from(matches.first['response'] as Map);
  }

  final rx = ReceivePort();
  final messages = <Map<Object?, Object?>>[];
  late final JsWorkerRunner runner;
  var nextId = 0;
  Future<Map<Object?, Object?>> wait(
    bool Function(Map<Object?, Object?>) match,
  ) async {
    final end = DateTime.now().add(const Duration(seconds: 90));
    while (DateTime.now().isBefore(end)) {
      for (final m in messages) {
        if (match(m)) return m;
      }
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    throw StateError('Timed out waiting for the native worker');
  }

  Future<void> load(String script) async {
    final id = nextId++;
    runner.handle({'ls': 1, 'id': id, 'payload': script, 'tag': null});
    final result = await wait((m) => m['ld'] == id || m['le'] == id);
    if (result.containsKey('le'))
      throw StateError('Plugin failed to load: ${result['msg']}');
  }

  Future<dynamic> invoke(String method, List<Object?> args) async {
    final id = nextId++;
    runner.handle({
      'iv': 1,
      'id': id,
      'fn': 'port.$method',
      'aj': jsonEncode(args),
    });
    final result = await wait((m) => m['ir'] == id);
    expect(result['err'], isNull);
    final envelope = result['result'] as Map;
    return envelope;
  }

  void dispose() {
    runner.handle({'dp': 1});
    rx.close();
  }
}
