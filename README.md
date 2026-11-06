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
viewer.js         the Gallery's 3D viewer (WebGL 2): Gaussian splats, deformation graph, cameras, 3D tracks
viewer-worker.js  its worker: poses the dynamic Gaussians through the graph at time t and depth-sorts all of them
assets/
  favicon.svg
  group-logo.png  Computational Robotics Group logo
  img/            teaser.jpg, view-graph.jpg (rendered from the paper figures)
    teaser/       crops of the teaser (from the paper's teaser.pdf) for the hero walkthrough
    runs/         posters of the Example runs clips
    solver-static.jpg, solver-edg.jpg   posters of the solver clips
  video/          the walkthrough's clips (horsejump-high); each plays over its panel at its stop (data-stop)
    teaser-tracks.mp4  Input: every input frame with its tracks, over the front frame of the 2D-tracks stack
    teaser-depth.mp4   Input: every frame's monocular depth, over the front frame of the depth stack
    teaser-lift.mp4    Lift: frame 33 lifted along its camera rays to its depth, over the Preprocess schematic
    teaser-solve.mp4   Solve: over panel (b), the XM solver's iterates on this video (from a replay of its solve
                       that saved every iterate: the cameras, and every frame's lifted depth placed by its camera
                       and depth scale), then the dynamic tracks through time (cameras along the path, tracks growing)
    teaser-render.mp4  Render: the trained model rendered at every frame from panel (c)'s camera and crop,
                       with its tracked keypoints
    runs/         the Example runs gallery below the teaser: per run, one input camera's render, 3D tracks, and
                  graph cells, cut from its showcase video (visualize_showcase_grid.py in the research code) by
                  4DReconstruction/scratchpad/page_assets/runs/build_runs.py;
                  posters in img/runs/
    solver-static.mp4  Inside the solver: the static solve's iterates (the first part of teaser-solve.mp4)
    solver-edg.mp4     Inside the solver: the iterates of one segment's EDG solve (horsejump-high, frames 0-10),
                       from a copy of the solver that saved every iterate (scripts and the patched solver headers:
                       4DReconstruction/scratchpad/page_assets/solver/)
  3d/             one file per Gallery run (4DReconstruction/scratchpad/page_assets/viewer/export_viewer.py): ~130k static
                  Gaussians fitted to the full model's renders, ~25k dynamic ones with their top-4 graph skinning,
                  the trained node tables, the input cameras, and the graph's edges
```

## Filling in the skeleton

- **Links:** the Paper buttons (top bar and hero) point to `#`; Code points to XM4D-release.
- **Venue, BibTeX:** see the `TODO` comments in `index.html`.
- **Hero video:** uncomment the `hero-video` block and drop the files under `assets/video/`.
- **Method figures:** each `.step` has a `data-img` that the sticky stage shows while the step is active.
- **Gallery runs:** add an `<option value="<key>" data-src="assets/3d/<key>.bin">` to the viewer's run picker; a
  value that matches an Example runs tab (`data-group`) is picked when that tab is.
