"""Convert browser frame sequences to H.264 MP4s and palette-optimized looping GIFs."""
from pathlib import Path
import argparse, subprocess, json
HERE=Path(__file__).resolve().parent
SCENES=[('01-collaboration',0,12),('02-accounts-access',12,12),('03-quick-tools',24,24),('04-libraries',48,12)]
def run(args): subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*args],check=True)
def export(lang):
    out=HERE/'exports';source=Path('/tmp/reroll-component-frames')/lang/'0000.jpg'
    if any(not (source.parent/f'{i:04}.jpg').exists() for i in range(600)):
        raise SystemExit(f'Expected 600 browser frames in {source.parent}')
    master=out/f'reroll-showcase-{lang}.mp4'
    run(['-framerate','10','-i',str(source.parent/'%04d.jpg'),'-vf','crop=1280:720:0:64,fps=30','-c:v','libx264','-crf','19','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(master)])
    for name,start,duration in SCENES:
        target=out/f'{name}-{lang}'
        run(['-ss',str(start),'-i',str(master),'-t',str(duration),'-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(target)+'.mp4'])
        run(['-ss',str(start),'-i',str(master),'-t',str(duration),'-filter_complex','fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle','-loop','0',str(target)+'.gif'])
        run(['-ss',str(start+min(9,duration-1)),'-i',str(master),'-frames:v','1','-update','1',str(target)+'.png'])
    # Each tool also has its own 4 s cut for editorial reuse.
    for i,name in enumerate(['layers','angle','cutout','lighting','depth','image-to-prompt']):
        run(['-ss',str(24+i*4),'-i',str(master),'-t','4','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(out/f'tool-{name}-{lang}.mp4')])
    files=[{'file':p.name,'bytes':p.stat().st_size} for p in sorted(out.glob(f'*-{lang}.*')) if p.suffix!='.json']
    (out/f'manifest-{lang}.json').write_text(json.dumps(files,indent=2))
    print(f'Exported {lang}: {len(files)} assets',flush=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('language',choices=['zh','en']);export(parser.parse_args().language)
