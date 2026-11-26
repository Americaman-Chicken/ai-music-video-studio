from playwright.sync_api import sync_playwright
import subprocess, time, pathlib, tempfile
from PIL import Image
root=pathlib.Path(__file__).resolve().parents[1];tmp=pathlib.Path(tempfile.mkdtemp());Image.new('RGB',(320,240),'blue').save(tmp/'image.png');subprocess.run(['ffmpeg','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2','-y',str(tmp/'audio.wav')],check=True)
server=subprocess.Popen(['python','-m','http.server','8765','--bind','127.0.0.1'],cwd=root/'app',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=__import__('os').environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],timeout=10000)
  page=b.new_page(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:8765/',timeout=10000);page.locator('#audio').set_input_files(tmp/'audio.wav');page.wait_for_function('document.querySelector("#player").duration>1');page.locator('#images').set_input_files(tmp/'image.png');page.wait_for_function('document.querySelector("#mediaInfo").textContent.includes("1枚")');page.locator('#lyrics').fill('夏の歌\n君へ');page.locator('#timing').select_option('even');page.locator('#saveProject').click();page.wait_for_function('document.querySelector("#localStatus").textContent.includes("保存しました")');page.reload();page.locator('#restoreProject').click();page.wait_for_function('document.querySelector("#localStatus").textContent.includes("復元しました")');page.wait_for_function('document.querySelector("#player").duration>1');page.locator('#analyze').click();page.wait_for_function('document.querySelector("#localStatus").textContent.includes("解析完了")');page.locator('#notes').fill('0-1秒: 画像1 ズームイン');page.locator('#makePlan').click();page.locator('#resolution').select_option('480');
  with page.expect_download(timeout=20000) as dl: page.locator('#renderLocal').click()
  path=tmp/dl.value.suggested_filename;dl.value.save_as(path);print('BROWSER PASS',path,errors);subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name,codec_type,width,height:format=duration','-of','json',str(path)],check=True);assert not errors;b.close()
finally:server.terminate()
