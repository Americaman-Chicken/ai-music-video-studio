# AI Music Video Studio 開発引き継ぎ

Android Chrome 向けの日本語 PWA。無料で使える端末内制作を優先し、楽曲、歌詞、画像、演出指示、API キーをリポジトリや外部サービスに送らない。テストには合成素材か再配布可能な素材を使用する。

- 利用方法と公開手順は README.md、実装・実測・残課題は DEVELOPMENT.md を参照。
- `app/index.html` と `app/studio.js` が画面と端末出力の入口。`app/video-export.mjs` が WebCodecs のエンコードを担当し、端末の対応状況によって MediaRecorder 経路を使う。`app/core.js` が楽曲・演出ロジック、`app/alignment.js` が時刻照合、`app/*worker.js` がバックグラウンド処理、`app/storage.js` が保存と v3.1 移行を担当する。
- `node tests/core.test.cjs`、`python -m unittest discover -s tests`、`python tests/browser_smoke.py` を実行する。ブラウザ出力はファイルのコンテナ、コーデック、解像度、尺を確認する。
- 同じ描画処理を端末プレビューと端末出力で使う。未対応コーデック、低一致率、モデルの取得失敗を画面に表示する。文字補間と音響強制アラインメントを区別する。
- PWA の資産追加時は Service Worker のプリキャッシュを更新する。Pages 用キャッシュ名は Actions がコミットごとに設定する。編集中にページを強制更新しない。
- Android 実機、モデル精度、MP4、公開の結果は実際に確認した環境とともに記述する。変更を段階ごとにコミットし、進捗と未検証項目を更新する。

- 実 Whisper の比較は tests/recognition_benchmark.py を使用。ローカル MP4 変換は convert_mp4.py で行い、ブラウザの直接出力と区別して検証する。
