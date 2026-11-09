# XM4D project page

Single-page site for *XM4D: 4D Reconstruction through Certifiable Geometric Optimization*
([arXiv:2611.07902](https://arxiv.org/abs/2611.07902)). Plain HTML, CSS, and JS; no build step.
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
viewer.js         the 3D viewers (WebGL 2; Gallery, fridge, kitchen twin): Gaussian splats, deformation graph, cameras, 3D tracks
viewer-worker.js  its worker: poses the dynamic Gaussians through the graph at time t and depth-sorts all of them
handobj.html      the hand-object viewer's page, opened from the Applications' "Open in 3D" links (#<clip> picks the clip)
handobj.js        that viewer (three.js 0.147 from jsDelivr, loaded when it nears the viewport): per clip, the object
                  meshes at their solved 6D poses, both hand skeletons, the camera and the table; a camera view over the
                  input frame with SAM 3's mask outlines dashed
fridge.html       the fridge's 3D viewer (viewer.js; a slider per door), opened from its application's "Open in 3D"
kitchen.html      the RoboCasa kitchen twin's 3D viewer (viewer.js; a slider per part, the view goes to each part)
assets/
  favicon.svg
  group-logo.png  Computational Robotics Group logo
  img/            teaser.jpg, view-graph.jpg (rendered from the paper figures)
    teaser/       crops of the teaser (from the paper's teaser.pdf) for the hero walkthrough
    runs/         posters of the Example runs clips
    solver/       posters of the solver clips
    apps/         posters of the Applications clips
  img/promo.jpg   the teaser's poster (its frame 0, the title card)
  video/          the walkthrough's clips (horsejump-high); each plays over its panel at its stop (data-stop)
    promo.mp4          the teaser, full screen above the page (84 s, 720p, music; the 720p web cut of v6, built in
                       xm4d_new/teaser/ on the Passport)
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
                  4DReconstruction/scratchpad/page_assets/runs/build_runs.py; the 14 DAVIS runs after hike (bmx-trees to
                  soapbox) are the extended DAVIS 2017 batch, every 8th frame held out, cut the same way from its
                  showcase_holdout.mp4 (build_ext.py in the session scratchpad);
                  posters in img/runs/
    solver/       Inside the solver, per run (horsejump-high, bear, car-roundabout, paper-windmill):
                  static-<run>.mp4, the static solve's iterates (the horse's is the first part of teaser-solve.mp4),
                  and edg-<run>.mp4, one segment's EDG solve from zero translation; both from a copy of the solver that
                  saved every iterate (scripts and the patched solver headers: 4DReconstruction/scratchpad/page_assets/solver/)
    apps/         Applications clips (scripts: 4DReconstruction/scratchpad/page_assets/apps/ unless noted):
                  robot-dance-twirl (DAVIS: render | a Unitree G1 in her place, robot_clips.py, top row trimmed); robot-skater (Pexels
                  skater, the G1's standing foot planted on the fitted ice, page_assets/skating/ deliver.sh, from frame 2); casa-pose (a RoboCasa robot carries a cereal box while
                  the camera moves: input with the box's mesh at our pose | the static kitchen with our camera path
                  and the box's, page_assets/robocasa_pose/ render_pose_clip.py); remove-car-roundabout (input |
                  without the dynamic Gaussians, render_removal.py); handobj-<clip> (five iPhone clips: input with our
                  hands and mesh outlines | MuJoCo, Hunyuan3D-2.1 meshes posed by their anchored tracks, round 6 of the
                  hand-object work, render_user5.py); all 12 fps; fridge-doors and casa-twin (30 fps): the
                  fridge.html and kitchen.html viewers' demos, one seamless loop each at the input camera's aspect,
                  recorded frame-exact with a virtual clock in a GPU headless Chrome (page_assets/viewer_pages/
                  record_viewer.py, record_native.sh); posters in img/apps/
  3d/             one file per Gallery run (4DReconstruction/scratchpad/page_assets/viewer/export_viewer.py): ~130k static
                  Gaussians fitted to the full model's renders, ~25k dynamic ones with their top-4 graph skinning,
                  the trained node tables, the input cameras, and the graph's edges; dancer.bin from page_assets/human/scripts/
                  export_viewer_fix.py (background thinned per voxel, so the white walls stay clean); casa-twin.bin
                  (the RoboCasa kitchen twin, monocular) from page_assets/robocasa/mono_v4/ (export_viewer_parts_v4.py: static
                  Gaussians within 1.4 m of the camera path dropped; then rename_parts.py for the part names, the caps
                  after review (drawer 75 %, cabinets 30/41, fridge doors 17/19 degrees), microwave and dishwasher fixed); casa-pose.bin
                  (the cereal box, Gallery) from page_assets/robocasa_pose/ (export_viewer.py)
                  bmx-trees ... soapbox: the extended DAVIS runs (bench/scenes/DAVIS/d17h_<key>, gsplat_holdout), --fps 10;
                  breakdance from its retrain with a floor on gsplat's scene scale (bench_debug/ssfix/, update_run.py
                  in page_assets/viewer_pages/, which also re-cuts its clip): its camera barely moves, so the scale
                  (the cameras' extent) had frozen the means and capped every Gaussian near one pixel
    handobj/      the hand-object viewer's clips (clips.json, then per clip meta.json, poses/cams/joints/points/objN .bin,
                  objN.jpg textures, contours.json from the SAM 3 masks, frames_NN.jpg input atlases), from export_viewer.py
                  in the hand-object scratchpad (hoviewer_r6/tools/)
```

## Filling in the skeleton

- **Links:** the Paper buttons (top bar and hero) point to arXiv:2611.07902; Code points to XM4D-release.
- **Venue, BibTeX:** see the `TODO` comments in `index.html`.
- **Teaser:** `div#teaser` above the top bar plays `assets/video/promo.mp4` full screen, muted, with Pause and Sound buttons
  and a scroll cue (as on the GRASP page); main.js fades it as the page scrolls up over it and pauses it off screen.
  Upright phones show the whole frame at full width; ultra-wide screens show it whole, its sides fading out.
- **Method figures:** each `.step` has a `data-img` that the sticky stage shows while the step is active.
- **Articulated runs** (fridge.html, kitchen.html): a `.viewer` with `data-src` (and no run picker) shows one run; a run exported with
  `--hinges` (assets/3d/fridge.bin) is posed by one slider per part, which turns about its fitted hinge (or, for a
  `prismatic` part, slides along its axis). A part with `"fixed": true` keeps its frame-0 pose and gets no slider.
  With `data-part-views` on the `.viewer` (assets/3d/casa-twin.bin), the input view glides to the camera that saw each part open
  furthest, in the demo and when its slider is moved.
- **Gallery runs:** add an `<option value="<key>" data-src="assets/3d/<key>.bin">` to the viewer's run picker; a
  value that matches an Example runs tab (`data-group`) is picked when that tab is.
- **3D tracks:** the viewer draws up to 110 dynamic Gaussians, spread out at frame 0, chosen only among opaque, not tiny
  ones in a dense part of the dynamic cloud whose paths are no more jagged than twice the run's median; faint floaters
  far from the body would otherwise zigzag through empty space (skating, playground). `data-tracks="off"` on an option
  shows none (truck: every node of its graph jitters in depth, so no track is clean).
