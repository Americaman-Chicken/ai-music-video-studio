"""Measure the production worker against known starts in synthetic speech."""
import argparse
from functools import partial
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import wave

from browser_smoke import QuietHandler, ROOT
import numpy as np
from playwright.sync_api import sync_playwright
import pyopenjtalk


def fixtures(folder):
    lyrics = ['夏の歌', '君へ届け', '夏の歌']
    starts = [0.5, 3.0, 5.5]
    rate = 48000
    speech = np.zeros(8 * rate)
    for text, start in zip(lyrics, starts):
        audio, sample_rate = pyopenjtalk.tts(text)
        assert sample_rate == rate
        onset = np.flatnonzero(np.abs(audio) >= 327)
        offset = round(start * rate)
        trimmed = audio[onset[0]:onset[-1] + 1] / 32768
        assert offset + len(trimmed) <= len(speech)
        speech[offset:offset + len(trimmed)] = trimmed
    time = np.arange(len(speech)) / rate
    accompaniment = (np.sin(2 * np.pi * 220 * time) + .6 * np.sin(2 * np.pi * 330 * time))
    accompaniment *= np.exp(-5 * np.mod(time, .5))
    scale = np.linalg.norm(speech) / np.linalg.norm(accompaniment)
    for name, mix in [('voice', speech), ('voice_plus_tones_5db', speech + scale * 10**(-5/20) * accompaniment)]:
        path = folder / (name + '.wav')
        with wave.open(str(path), 'wb') as out:
            out.setparams((1, 2, rate, 0, 'NONE', ''))
            out.writeframes((np.clip(mix, -1, 32767/32768) * 32768).astype('<i2').tobytes())
        yield path, lyrics, starts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ignore-tls-errors', action='store_true')
    parser.add_argument('--model', choices=['tiny', 'base'], default='tiny')
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=ROOT))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with TemporaryDirectory() as tmp, sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH'),
                                        args=['--no-sandbox', '--disable-dev-shm-usage'])
            page = browser.new_page(ignore_https_errors=args.ignore_tls_errors)
            page.goto(f'http://127.0.0.1:{server.server_port}/app/')
            page.locator('#recognitionModel').select_option(args.model)
            for path, lyrics, starts in fixtures(Path(tmp)):
                page.locator('#audio').set_input_files(path)
                page.wait_for_function("document.querySelector('#mediaInfo').textContent.includes(" +
                                       json.dumps(path.name) + ") && document.querySelector('#player').duration === 8")
                page.locator('#lyrics').fill('\n'.join(lyrics))
                page.locator('#recognize').click()
                page.wait_for_function("""() => {
                    const status = document.querySelector('#localStatus').textContent;
                    return status && !/読み込み中|取得中|認識中/.test(status);
                }""", timeout=120000)
                rows = page.locator('#syncReview input').evaluate_all('(inputs) => inputs.map(input => input.value)')
                status = page.locator('#localStatus').inner_text()
                if not rows and '照合できる歌唱' not in status:
                    raise RuntimeError(status)
                measured = [float(value) if value else None for value in rows] or [None] * len(starts)
                errors = [round(abs(ref - found), 3) if found is not None else None
                          for ref, found in zip(starts, measured)]
                print(json.dumps({'fixture': path.stem, 'model': args.model, 'status': status, 'expected_sec': starts,
                                  'suggested_sec': measured, 'absolute_error_sec': errors}, ensure_ascii=False), flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
