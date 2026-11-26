# AI Music Video Studio 3.1 — 開発版

## 公開・Androidインストール
1. ZIPを展開し、GitHubで公開用リポジトリを作成。ソースをmainへ登録する（`.github`を含む）。素材・歌詞・APIキーは登録しない。
2. Settings → Pages → Build and deployment → Source を GitHub Actions にする。
3. Actions → Publish app → Run workflow。成功したら Settings → Pages またはデプロイ結果に表示される実際のURLを開く。通常 `https://ユーザー名.github.io/リポジトリ名/`。
4. Android Chromeで開き、メニューの「アプリをインストール」または「ホーム画面に追加」。
5. app/をmainへpushすると再公開される。リリースごとにapp/sw.jsのCACHE名を変更する。旧版を閉じて再起動すると待機中の新版が有効になる。編集途中の強制リロードはしない。更新確認ボタンも利用可能。

## 制作
音源・画像・歌詞を入力。解析ボタンでBPMと拍グリッド、反復・音響特徴による区間候補を計算する。区間名を選択して修正できる。演出指示はルール方式でありLLMではない。例：
```
白黒、フェード
10-20秒: 画像2 ズームイン
サビ: 揺れ、中央
```
「演出プランを作成・更新」で区間プランを生成。JSONを編集して適用可能。画像指定がない場合は8拍ごとに切り替える。歌詞はLRC、タップ同期、タイムライン編集、均等仮配置に対応。均等配置は実際の歌唱同期ではない。出力区間を設定すれば部分動画を再出力できる（既存MP4への自動差替えではない）。保存はIndexedDBの1件。端末データ消去やストレージ回収に備え素材ZIPも保管する。

端末内出力はCanvasとWeb AudioをMediaRecorderで合成する。MP4対応環境ではMP4、それ以外はWebM。横・縦、480/720/1080短辺、30fps目標。端末の負荷に依存。画面を閉じない。素材は自動送信しない。端末ストレージの暗号化をアプリとして保証するものではない。

## Whisperによる同期（任意、PCまたは非公開環境）
素材ZIPを展開してpublic/へ配置し、Python 3.11で `pip install faster-whisper==1.1.1`、`python align.py` を実行。モデル取得には通信が必要。歌詞タイミングはautoを選択しておく。out/alignment.jsonをアプリに読み込むと文字進行を表示できる。認識語の時刻から文字を補間するため真の音響強制アラインメントではない。低一致率は失敗として扱う。歌唱・漢字表記・反復で誤差が生じる。

旧Remotionクラウド出力は残しているが端末プレビューと異なる。非公開リポジトリでのみRender MVワークフローを実行可能。非公開でも素材はGitHubへ送信され履歴に残るため、未公開作品ではローカルPC処理を推奨。無料枠の超過には注意。public/は誤コミット防止のためgitignore対象。クラウドへ送る場合のみ明示的に登録する。out/は公開しない。

## テスト
`node tests/core.test.cjs`、`python -m unittest discover -s tests`。ブラウザテストは `pip install playwright pillow`、`python -m playwright install chromium`、FFmpeg導入後 `python tests/browser_smoke.py`。GitHub Actionsにも登録済み。

## 未完了・検証制限
ブラウザ管理ポリシーがlocalhostを拒否したため実行テスト・ffprobe検証は未完了。Android実機、3分音源、実際のWhisperモデル、GitHubデプロイも未検証。真の強制アラインメント、スマホ内歌唱認識、LLMによる自由文設計、精密な曲構成分類、複数プロジェクト管理、全端末MP4保証、クラウドとの描画統一は未完了。公開済み完成版ではない。
