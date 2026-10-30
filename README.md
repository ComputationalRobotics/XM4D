# XM4D project page

Single-page site for *XM4D: Non-Rigid ConveX Structure from Motion with Embedded
Deformation Graphs for 4D Reconstruction*. Plain HTML, CSS, and JS; no build step.
The layout is adapted from the [BEACON](https://github.com/ComputationalRobotics/BEACON)
page, which is based on the
[gated-memory-policy template](https://github.com/gated-memory-policy/gated-memory-policy.github.io)
(CC BY-SA 4.0).

## Preview

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

## Files

```text
index.html        all page content
style.css         all styling; colors are tokens under :root (--accent = xmblue, --accent-2 = xmorange)
main.js           BibTeX copy, gallery tabs, lazy video playback, method-step figure swap
assets/
  favicon.svg
  group-logo.png  Computational Robotics Group logo
  img/            teaser.jpg, view-graph.jpg (rendered from the paper figures)
    teaser/       crops of the teaser (from the paper's teaser.pdf) for the hero walkthrough
  video/          the walkthrough's clips (horsejump-high); each plays over its panel at its stop (data-stop)
    teaser-tracks.mp4  Input: every input frame with its tracks, over the front frame of the 2D-tracks stack
    teaser-depth.mp4   Input: every frame's monocular depth, over the front frame of the depth stack
    teaser-lift.mp4    Lift: frame 33 lifted along its camera rays to its depth, over the Preprocess schematic
    teaser-solve.mp4   Cameras and Motion: panel (b) through time (cameras along the path, tracks growing)
    teaser-render.mp4  Render: the trained model rendered at every frame from panel (c)'s camera and crop,
                       with its tracked keypoints
```

## Filling in the skeleton

- **Links:** the Paper buttons (top bar and hero) point to `#`; Code points to XM4D-release.
- **Venue, BibTeX:** see the `TODO` comments in `index.html`.
- **Hero video:** uncomment the `hero-video` block and drop the files under `assets/video/`.
- **Method figures:** each `.step` has a `data-img` that the sticky stage shows while the step is active.
- **Result videos:** replace a `<div class="tile-ph">` with
  `<video muted loop playsinline preload="none" poster="….jpg" data-src="….mp4"></video>`;
  `main.js` loads it lazily and plays it only while it is on screen.
