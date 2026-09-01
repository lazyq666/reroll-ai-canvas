# Project-owned media fixtures

These assets are original test fixtures created for this repository. They do
not contain third-party photographs, artwork, music, trademarks, or generated
model output.

- `fixture.svg` is a hand-authored geometric SVG.
- `fixture.mp4` is a three-second synthetic color-pattern video with a sine
  tone, generated entirely from FFmpeg filters:

  ```bash
  ffmpeg -f lavfi -i 'testsrc2=size=736x414:rate=24' \
    -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
    -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest fixture.mp4
  ```

The fixtures are covered by the repository-level license.
