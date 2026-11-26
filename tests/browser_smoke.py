"""Use synthetic assets and validate the exported bytes with FFmpeg."""
import json
import os
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread

from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    release = 1

    def do_GET(self):
        if self.path == '/app/sw.js' and self.release > 1:
            data = (ROOT / 'app/sw.js').read_text().replace('mv-studio-v3.2', 'mv-studio-test-update')
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data.encode())
            return
        super().do_GET()

    def log_message(self, *_):
        pass


def inspect_video(path, codecs, dimensions, duration):
    result = subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-show_packets', '-of', 'json', str(path),
    ], text=True)
    info = json.loads(result)
    assert path.suffix[1:] in info['format']['format_name'].split(','), info['format']
    streams = {stream['codec_type']: stream for stream in info['streams']}
    assert streams['video']['codec_name'] in codecs[0], streams
    assert streams['audio']['codec_name'] in codecs[1], streams
    assert (streams['video']['width'], streams['video']['height']) == dimensions, streams
    seconds = max(float(packet.get('pts_time', 0)) for packet in info['packets'])
    assert abs(seconds - duration) < .28, seconds
    print(f'{path.name}: {dimensions}, {seconds:.2f}s, '
          f"{streams['video']['codec_name']}/{streams['audio']['codec_name']}", flush=True)


def export(page, directory, output_format, ratio, expected_duration):
    page.locator('#format').select_option(output_format)
    page.locator('#ratio').select_option(ratio)
    with page.expect_download(timeout=15000) as event:
        page.locator('#renderLocal').click()
    download = event.value
    assert download.suggested_filename.endswith('.' + output_format)
    path = directory / (ratio + '.' + output_format)
    download.save_as(path)
    expected_codecs = ({'h264'}, {'aac'}) if output_format == 'mp4' else ({'vp8', 'vp9'}, {'opus'})
    inspect_video(path, expected_codecs, (854, 480) if ratio == 'landscape' else (480, 854), expected_duration)
    return path


def test_ai_integration(browser, base_url, directory):
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    # Exercise UI and validation independently of public model downloads and GPU availability.
    page.route('**/ai-worker.js', lambda route: route.fulfill(
        content_type='text/javascript', body="""
        self.onmessage = ({data}) => {
          if (data.action === 'recognize') {
            const first = data.samples.length === 32000 ? '夏の歌' : '別の曲';
            self.postMessage({result: [{text:first,timestamp:[.2,.6]},{text:'君へ',timestamp:[1,1.5]}]});
          } else if (data.context.notes === '待機') {
            // The controller must terminate a worker that has not returned.
          } else if (data.context.notes === '失敗') {
            self.postMessage({error:'WebGPUを利用できません'});
          } else {
            self.postMessage({result:{base:{mono:true},scenes:[{start:0,end:1,camera:'pan'}]}});
          }
        };"""))
    page.goto(base_url + '/app/')
    page.locator('#audio').set_input_files(directory / 'audio.wav')
    page.wait_for_function('document.querySelector("#player").duration > 1')
    page.locator('#lyrics').fill('夏の歌\n君へ')
    page.locator('#recognize').click()
    expect(page.locator('#applySync')).to_be_enabled()
    expect(page.locator('#lyrics')).to_have_value('夏の歌\n君へ')
    page.locator('#applySync').click()
    expect(page.locator('#lyrics')).to_have_value('[00:00.20] 夏の歌\n[00:01.00] 君へ')
    page.locator('#lyrics').fill('猫と犬')
    page.locator('#recognize').click()
    expect(page.locator('#localStatus')).to_contain_text('手動またはタップ同期')
    expect(page.locator('#applySync')).to_be_disabled()
    expect(page.locator('#lyrics')).to_have_value('猫と犬')
    page.locator('#candidateTime0').fill('0.5')
    page.locator('#applySync').click()
    expect(page.locator('#lyrics')).to_have_value('[00:00.50] 猫と犬')
    page.locator('#planEngine').select_option('llm')
    page.locator('#notes').fill('待機')
    page.locator('#makePlan').click()
    page.locator('#cancelAI').click()
    expect(page.locator('#localStatus')).to_have_text('中止しました')
    page.locator('#notes').fill('失敗')
    page.locator('#makePlan').click()
    expect(page.locator('#localStatus')).to_contain_text('ルール解析を適用しました')
    page.locator('#notes').fill('')
    page.locator('#makePlan').click()
    expect(page.locator('#localStatus')).to_have_text('演出プランを更新しました')
    assert json.loads(page.locator('#sceneJson').input_value())['scenes'][0]['camera'] == 'pan'
    context.close()


def test_long_export(browser, base_url, directory):
    path = directory / 'three-minute.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                    r'aevalsrc=if(lt(mod(t\,0.5)\,0.035)\,0.7*sin(2*PI*220*t)\,0):s=16000:d=180',
                    str(path)], check=True)
    context = browser.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
    page = context.new_page()
    page.goto(base_url + '/app/')
    page.locator('#audio').set_input_files(path)
    page.wait_for_function('document.querySelector("#player").duration === 180')
    page.locator('#images').set_input_files(directory / 'image.png')
    expect(page.locator('#mediaInfo')).to_contain_text('1枚')
    page.locator('#analyze').click()
    expect(page.locator('#localStatus')).to_contain_text('解析完了', timeout=15000)
    assert abs(float(page.locator('#bpm').input_value()) - 120) <= 3
    print(page.locator('#sections').inner_text(), flush=True)
    page.locator('#format').select_option('webm')
    page.bring_to_front()
    with page.expect_download(timeout=235000) as event:
        page.locator('#renderLocal').click()
        expect(page.locator('#localStatus')).to_contain_text('書き出し', timeout=10000)
        expect(page.locator('#localStatus')).to_have_text(re.compile('完了|失敗|中止'), timeout=230000)
        expect(page.locator('#localStatus')).to_have_text('書き出し完了')
    target = directory / 'three-minute.webm'
    event.value.save_as(target)
    inspect_video(target, ({'vp8', 'vp9'}, {'opus'}), (1280, 720), 180)
    context.close()


def test_browser(base_url, directory):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH'), args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        context = browser.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
        page = context.new_page()
        errors = []
        external = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        context.on('request', lambda request: external.append(request.url)
                   if request.url.startswith(('http:', 'https:')) and not request.url.startswith(base_url) else None)
        page.goto(base_url + '/')
        # Recreate a v3.1 database on a separate origin context before loading v3.2.
        migration_context = browser.new_context(service_workers='block')
        migration = migration_context.new_page()
        migration.route('**/app/legacy', lambda route: route.fulfill(body='legacy', content_type='text/html'))
        migration.goto(base_url + '/app/legacy')
        migration.evaluate("""() => new Promise((resolve, reject) => {
          const request = indexedDB.open('mv-studio-projects', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('projects').put(
            {fields: {title: '旧プロジェクト', lyrics: '旧歌詞', timing: 'even'}}, 'current');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => { request.result.close(); resolve(); };
        })""")
        migration.goto(base_url + '/app/')
        expect(migration.locator('#projectList option[value=legacy]')).to_have_text('旧プロジェクト')
        migration.locator('#restoreProject').click()
        expect(migration.locator('#title')).to_have_value('旧プロジェクト')
        migration_context.close()

        page.locator('#title').fill('夏の歌')
        page.locator('#audio').set_input_files(directory / 'audio.wav')
        page.wait_for_function('document.querySelector("#player").duration > 1')
        page.locator('#images').set_input_files(directory / 'image.png')
        expect(page.locator('#mediaInfo')).to_contain_text('1枚')
        page.locator('#lyrics').fill('夏の歌\n君へ')
        page.locator('#timing').select_option('even')
        page.locator('#saveProject').click()
        expect(page.locator('#localStatus')).to_contain_text('保存しました')
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('#newProject').click()
        expect(page.locator('#localStatus')).to_have_text('新規プロジェクト')
        page.locator('#title').fill('別の曲')
        page.locator('#saveProject').click()
        expect(page.locator('#projectList option')).to_have_count(3)
        page.reload()
        page.locator('#projectList').select_option(label='夏の歌')
        page.locator('#restoreProject').click()
        expect(page.locator('#localStatus')).to_contain_text('復元しました')
        page.wait_for_function('document.querySelector("#player").duration > 1')
        page.locator('#analyze').click()
        expect(page.locator('#localStatus')).to_contain_text('解析完了')
        page.locator('#notes').fill('0-1秒: 画像1 ズームイン')
        page.locator('#makePlan').click()
        page.locator('#rangeStart').fill('0.5')
        page.locator('#rangeEnd').fill('1.5')
        page.locator('#notes').fill('白黒')
        page.locator('#regenerate').click()
        scenes = json.loads(page.locator('#sceneJson').input_value())['scenes']
        assert [(scene['start'], scene['end']) for scene in scenes] == [(0, .5), (.5, 1.5)], scenes

        page.locator('#timelineTracks [aria-label=演出] button').first.click()
        page.locator('#sceneCamera').select_option('out')
        page.locator('#saveScene').click()
        assert json.loads(page.locator('#sceneJson').input_value())['scenes'][0]['camera'] == 'out'
        page.locator('#resolution').select_option('480')
        page.locator('#format').select_option('webm')
        page.locator('#renderLocal').click()
        expect(page.locator('#cancelRender')).to_be_enabled()
        page.locator('#cancelRender').click()
        expect(page.locator('#localStatus')).to_contain_text('中止しました')
        expect(page.locator('#renderLocal')).to_be_enabled()
        page.evaluate("""() => {window.savedVideoEncoder = window.VideoEncoder; window.VideoEncoder = undefined;}""")
        try:
            export(page, directory, 'webm', 'portrait', 1.0)
        finally:
            page.evaluate('() => {window.VideoEncoder = window.savedVideoEncoder; delete window.savedVideoEncoder;}')
        page.locator('#rangeStart').fill('')
        page.locator('#rangeEnd').fill('')
        mp4 = page.evaluate("""async () => {
          const {encodingOptions} = await import('./video-export.mjs');
          return Boolean(await encodingOptions(true, 854, 480, 1)) ||
            ['avc1.640028', 'avc1.42001f'].some(codec =>
              MediaRecorder.isTypeSupported('video/mp4;codecs="' + codec + ',mp4a.40.2"'));
        }""")
        codec = 'mp4' if mp4 else 'webm'
        if not mp4:
            page.locator('#format').select_option('mp4')
            page.locator('#renderLocal').click()
            expect(page.locator('#localStatus')).to_contain_text('WebMを選択')
            print('H.264/AAC encoder unavailable. Verified explicit format fallback.', flush=True)
        path = export(page, directory, codec, 'landscape', 2.0)
        # Blue source image is present at the same position in the shared preview and export.
        page.locator('#seekTimeline').evaluate("(input) => {input.value = 1; input.dispatchEvent(new Event('input'));}")
        page.wait_for_function('!document.querySelector("#player").seeking && document.querySelector("#player").currentTime === 1')
        pixel = page.locator('#preview').evaluate('(canvas) => Array.from(canvas.getContext("2d").getImageData(100,100,1,1).data)')
        video_pixel = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', '1', '-i', str(path),
            '-frames:v', '1', '-vf', 'format=rgb24,crop=1:1:100:100', '-f', 'rawvideo', '-'])
        assert len(video_pixel) == 3 and max(abs(pixel[i]-video_pixel[i]) for i in range(3)) < 35, (pixel, video_pixel)

        page.evaluate('navigator.serviceWorker.ready.then(() => true)')
        page.wait_for_function('!!navigator.serviceWorker.controller')
        context.set_offline(True)
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('#projectList option')).to_have_count(3)
        context.set_offline(False)
        page.locator('#title').fill('未保存の編集中データ')
        QuietHandler.release = 2
        page.evaluate('navigator.serviceWorker.ready.then(registration => registration.update())')
        page.wait_for_function('navigator.serviceWorker.getRegistration().then(registration => !!registration.waiting)')
        expect(page.locator('#title')).to_have_value('未保存の編集中データ')
        page.close()
        page = context.new_page()
        page.goto(base_url + '/app/')
        page.wait_for_function("caches.keys().then(keys => keys.includes('mv-studio-test-update') && !keys.includes('mv-studio-v3.2'))")
        assert not errors, errors
        assert not external, external
        context.close()
        test_ai_integration(browser, base_url, directory)
        if os.environ.get('MV_LONG_TEST') == '1':
            test_long_export(browser, base_url, directory)
        browser.close()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=ROOT))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with TemporaryDirectory() as folder:
            directory = Path(folder)
            Image.new('RGB', (320, 240), 'blue').save(directory / 'image.png')
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i',
                            'sine=frequency=440:duration=2', str(directory / 'audio.wav')], check=True)
            test_browser(f'http://127.0.0.1:{server.server_port}', directory)
    finally:
        server.shutdown()
        server.server_close()
