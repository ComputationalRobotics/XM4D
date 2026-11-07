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
viewer.js         the 3D viewers (WebGL 2; Gallery, fridge): Gaussian splats, deformation graph, cameras, 3D tracks
viewer-worker.js  its worker: poses the dynamic Gaussians through the graph at time t and depth-sorts all of them
assets/
  favicon.svg
  group-logo.png  Computational Robotics Group logo
  img/            teaser.jpg, view-graph.jpg (rendered from the paper figures)
    teaser/       crops of the teaser (from the paper's teaser.pdf) for the hero walkthrough
    runs/         posters of the Example runs clips
    solver/       posters of the solver clips
    apps/         posters of the Applications clips
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
    solver/       Inside the solver, per run (horsejump-high, bear, car-roundabout, paper-windmill):
                  static-<run>.mp4, the static solve's iterates (the horse's is the first part of teaser-solve.mp4),
                  and edg-<run>.mp4, one segment's EDG solve from zero translation; both from a copy of the solver that
                  saved every iterate (scripts and the patched solver headers: 4DReconstruction/scratchpad/page_assets/solver/)
    apps/         Applications clips (scripts: 4DReconstruction/scratchpad/page_assets/apps/ unless noted):
                  robot-dance-twirl (DAVIS: render | a Unitree G1 in her place, robot_clips.py, top row trimmed); casa-pose (a RoboCasa robot carries a cereal box while
                  the camera moves: input with the box's mesh at our pose | the static kitchen with our camera path
                  and the box's, page_assets/robocasa_pose/ render_pose_clip.py); remove-car-roundabout (input |
                  without the dynamic Gaussians, render_removal.py); all 12 fps; posters in img/apps/
  3d/             one file per Gallery run (4DReconstruction/scratchpad/page_assets/viewer/export_viewer.py): ~130k static
                  Gaussians fitted to the full model's renders, ~25k dynamic ones with their top-4 graph skinning,
                  the trained node tables, the input cameras, and the graph's edges; dancer.bin from page_assets/human/scripts/
                  export_viewer_fix.py (background thinned per voxel, so the white walls stay clean); casa-pose.bin
                  (the cereal box, Gallery) from page_assets/robocasa_pose/ (export_viewer.py)
```

## Filling in the skeleton

- **Links:** the Paper buttons (top bar and hero) point to `#`; Code points to XM4D-release.
- **Venue, BibTeX:** see the `TODO` comments in `index.html`.
- **Hero video:** uncomment the `hero-video` block and drop the files under `assets/video/`.
- **Method figures:** each `.step` has a `data-img` that the sticky stage shows while the step is active.
- **Articulated runs:** a `.viewer` with `data-src` (and no run picker) shows one run; a run exported with
  `--hinges` (assets/3d/fridge.bin) is posed by one slider per part, which turns about its fitted hinge (or, for a
  `prismatic` part, slides along its axis). A part with `"fixed": true` keeps its frame-0 pose and gets no slider.
  With `data-part-views` on the `.viewer`, the input view glides to the camera that saw each part open
  furthest, in the demo and when its slider is moved.
- **Gallery runs:** add an `<option value="<key>" data-src="assets/3d/<key>.bin">` to the viewer's run picker; a
  value that matches an Example runs tab (`data-group`) is picked when that tab is.
