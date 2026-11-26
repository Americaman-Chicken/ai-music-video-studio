"""Convert a Studio export to an H.264/AAC MP4 on this computer."""
import argparse
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory


def convert(source, destination):
    if destination.suffix.lower() != '.mp4':
        raise ValueError('出力ファイル名の末尾は .mp4 にしてください')
    if destination.exists():
        raise FileExistsError(destination)
    with TemporaryDirectory(dir=destination.parent, prefix='.mv-convert-') as folder:
        temporary = Path(folder) / 'video.mp4'
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
            '-protocol_whitelist', 'file', '-i', str(source.resolve()), '-map', '0:v:0', '-map', '0:a:0',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
            str(temporary.resolve()),
        ], check=True)
        with temporary.open('rb') as src:
            output = destination.open('xb')
            try:
                with output:
                    shutil.copyfileobj(src, output)
            except BaseException:
                destination.unlink(missing_ok=True)
                raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    try:
        convert(args.source, args.destination)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'MP4 変換に失敗しました。 {error}\n')
    print(args.destination)


if __name__ == '__main__':
    main()
