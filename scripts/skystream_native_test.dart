// Run from a SkyStream checkout with its Flutter toolchain:
// SKYSTREAM_PLUGIN_ROOT=/path/to/skystream-ukrainian flutter test /path/to/this_file.dart
// Uses the real SkyStream worker/DOM bridge and models, with normal Dio HTTP.
// It does not exercise UI, the app's Cloudflare/cookie orchestration or playback.
@Timeout(Duration(minutes: 3))
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:archive/archive.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:skystream/core/domain/entity/multimedia_item.dart';
import 'package:skystream/core/extensions/engine/js_engine_worker.dart';

void main() {
  test('built UAKino package runs in the native SkyStream worker', () async {
    final root = Platform.environment['SKYSTREAM_PLUGIN_ROOT']!;
    final archive = ZipDecoder().decodeBytes(
      File('$root/dist/com.vladislawfox.ukrainian.uakino.sky')
          .readAsBytesSync(),
    );
    final script = utf8.decode(archive.findFile('plugin.js')!.content);
    final manifest = utf8.decode(archive.findFile('plugin.json')!.content);
    final harness = Harness();
    addTearDown(harness.dispose);
    await harness.load(
      '(function(){ const manifest = $manifest; $script\n globalThis.uakino = {getHome, search, load, loadStreams}; })();',
    );
    final home = await harness.invoke('getHome', []);
    expect((home as Map).length, 6);
    final found = await harness.invoke('search', ['Німона']) as List;
    expect(found, isNotEmpty);
    final movie = MultimediaItem.fromJson(
      Map<String, dynamic>.from(
        await harness.invoke('load', [found.first['url']]) as Map,
      ),
    );
    expect(movie.title, 'Німона');
    expect(movie.contentType, MultimediaContentType.movie);
    expect(movie.year, 2023);
    final filmStreams =
        (await harness.invoke('loadStreams', [movie.url]) as List)
            .map(
              (s) => StreamResult.fromJson(Map<String, dynamic>.from(s as Map)),
            )
            .toList();
    expect(filmStreams, isNotEmpty);
    expect(filmStreams.first.headers?['Referer'], isNotEmpty);
    expect(filmStreams.first.subtitles, isNotEmpty);
    final series = MultimediaItem.fromJson(
      Map<String, dynamic>.from(
        await harness.invoke('load', [
          'https://uakino.best/seriesss/dokymentalni/23428-dyva-pryrody-bi-bi-si-naivelychnishi-podii-zhyvoi-pryrody-1-sezon.html',
        ]) as Map,
      ),
    );
    expect(series.contentType, MultimediaContentType.series);
    expect(series.episodes!.length, 6);
    expect(series.episodes!.first.episode, 1);
    final episodeStreams =
        (await harness.invoke('loadStreams', [series.episodes!.first.url])
                as List)
            .map(
              (s) => StreamResult.fromJson(Map<String, dynamic>.from(s as Map)),
            )
            .toList();
    expect(episodeStreams.length, greaterThanOrEqualTo(3));
    // In replay mode these are the recorded live HLS/subtitle responses.
    final hls = await harness.request({
      'method': 'GET',
      'url': filmStreams.first.url,
      'headers': filmStreams.first.headers,
    });
    expect(hls['status'], 200);
    expect((hls['body'] as String).trimLeft(), startsWith('#EXTM3U'));
    final subtitle = await harness.request({
      'method': 'GET',
      'url': filmStreams.first.subtitles!.first.url,
      'headers': filmStreams.first.headers,
    });
    expect(subtitle['status'], 200);
    expect(subtitle['body'], contains('-->'));
    final report = {
      'checkedAt': DateTime.now().toUtc().toIso8601String(),
      'runtime': 'SkyStream JsWorkerRunner on macOS (JavaScriptCore)',
      'httpMode': harness.fixtures == null
          ? 'live Dio'
          : 'recorded live responses',
      'homeSections': home.length,
      'movie': movie.title,
      'movieStreams': filmStreams.length,
      'movieSubtitles': filmStreams.first.subtitles!.length,
      'series': series.title,
      'episodes': series.episodes!.length,
      'episode1Streams': episodeStreams.length,
      'hlsStatus': hls['status'],
      'subtitleStatus': subtitle['status'],
      'physicalPlaybackTested': false,
    };
    File('$root/.local/native-report.json')
        .writeAsStringSync(const JsonEncoder.withIndent('  ').convert(report));
    print(jsonEncode(report));
  });
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
  final List<dynamic>? fixtures =
      Platform.environment['SKYSTREAM_HTTP_FIXTURES'] == null
      ? null
      : jsonDecode(
          File(Platform.environment['SKYSTREAM_HTTP_FIXTURES']!)
              .readAsStringSync(),
        ) as List;
  String normalized(String url) =>
      url.replaceAll(RegExp(r'time=\d+'), 'time=0');
  Future<Map<String, dynamic>> request(Map<String, dynamic> args) async {
    if (fixtures != null) {
      final matches = fixtures!.where(
        (entry) =>
            entry['method'] == args['method'] &&
            normalized(entry['url'] as String) ==
                normalized(args['url'] as String) &&
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
    try {
      final result = await dio.request<String>(
        args['url'] as String,
        data: args['body'],
        options: Options(
          method: args['method'] as String,
          headers: {
            ...Map<String, dynamic>.from(args['headers'] as Map),
            'Accept-Encoding': 'identity',
          },
          responseType: ResponseType.plain,
          validateStatus: (_) => true,
          followRedirects: true,
        ),
      );
      if (result.statusCode != 200) {
        final uri = Uri.parse(args['url'] as String);
        print(
          'HTTP ${result.statusCode}: ${uri.host}${uri.path}; challenge=${result.data?.contains("challenge-platform")}',
        );
      }
      return {
        'status': result.statusCode,
        'body': result.data,
        'headers': result.headers.map,
      };
    } catch (_) {
      return {'status': 0, 'body': '', 'headers': {}};
    }
  }

  final rx = ReceivePort();
  final dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
    ),
  );
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
      'fn': 'uakino.$method',
      'aj': jsonEncode(args),
    });
    final result = await wait((m) => m['ir'] == id);
    expect(result['err'], isNull);
    final envelope = result['result'] as Map;
    expect(
      envelope['success'],
      true,
      reason: '$method: ${envelope['message']}',
    );
    return envelope['data'];
  }

  void dispose() {
    runner.handle({'dp': 1});
    rx.close();
    dio.close(force: true);
  }
}
