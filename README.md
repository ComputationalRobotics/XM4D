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
embed.js          fridge.html, kitchen.html and handobj.html inside the Gallery's frame (?embed: no top bar or heading;
                  reports the page's height so the frame fits it)
handobj.js        that viewer (three.js 0.147 from jsDelivr, loaded when it nears the viewport): per clip, the object
                  meshes at their solved 6D poses, both hand skeletons, the camera and the table; a camera view over the
                  input frame with SAM 3's mask outlines dashed
fridge.html       the fridge's 3D viewer (viewer.js; a slider per door), opened from its application's "Open in 3D"
kitchen.html      the RoboCasa kitchen twin's 3D viewer (viewer.js; a slider per part, the view goes to each part)
assets/
  favicon.svg
  group-logo.png  Computational Robotics Group logo (group-logo-alpha.png: its white made transparent, for the teaser's overlay)
  harvard-shield.svg  Harvard shield (from the group's GRASP page), for the teaser's overlay
  img/            teaser.jpg, view-graph.jpg (the arXiv paper's overview and view-graph figures, from 2026-pami-xm4d/arxiv-crg/figures/)
    runs/         posters of the Gallery's clips
    solver/       posters of the solver clips
    apps/         posters of the Applications clips
  img/promo.jpg   the teaser's poster: frame 0 of the text-free cut (the overlay draws the title over it, so it shows once)
  video/
    promo-1440.mp4, promo-1080.mp4, promo-720.mp4
                       the teaser, full screen above the page (79.2 s, music; v7.2, with its clips re-rendered at 2x; built in xm4d_new/teaser/ on the
                       Passport), without its titles, labels and logos: main.js draws those as SVG over it from
    promo-text.json    (per item: text runs, font, box; per frame: x, y, opacity, scale, in the 1920x1080 design
                       space), so the text is as sharp as the page's. The <video> lists the three with media
                       conditions, so a screen loads only the sharpest one it can use
    promo-720-text.mp4 the 720p cut with its text baked in: the fallback if promo-text.json cannot be read
    runs/         the Gallery's clips (Videos, above the 3D viewer): per run, one input camera's render, 3D tracks, and
                  graph cells, cut from its showcase video (visualize_showcase_grid.py in the research code) by
                  4DReconstruction/scratchpad/page_assets/runs/build_runs.py; the 14 DAVIS runs after hike (bmx-trees to
                  soapbox) are the extended DAVIS 2017 batch, every 8th frame held out, cut the same way from its
                  showcase_holdout.mp4 (build_ext.py in the session scratchpad); the 3D-tracks cell then redrawn by
                  page_assets/runs/tracks_from_bin.py from the run's 3d/<key>.bin (its stored tracks, as the viewer draws
                  them; the render and graph cells cut again from the grid); Syn4D bear1-4 / casa1-4 and the cereal box
                  from grids rendered by page_assets/runs/grids/render_grids.sh;
                  disc-jockey and kids-turning (DAVIS 2017, two people each) from their held-out runs, with SAM 3 masks
                  (not the DAVIS annotations) and one COCO skeleton per person (xm4d_new/dance_gallery/ on the Passport);
                  posters in img/runs/
    solver/       Inside the solver, per run (horsejump-high, bear, car-roundabout, paper-windmill):
                  static-<run>.mp4, the static solve's iterates,
                  and edg-<run>.mp4, one segment's EDG solve from zero translation; both from a copy of the solver that
                  saved every iterate (scripts and the patched solver headers: 4DReconstruction/scratchpad/page_assets/solver/)
    apps/         Applications clips (scripts: 4DReconstruction/scratchpad/page_assets/apps/ unless noted):
                  robot-dance-twirl (DAVIS: render | a Unitree G1 in her place, robot_clips.py, top row trimmed); robot-skater (Pexels
                  skater, the G1's standing foot planted on the fitted ice, page_assets/skating/ deliver.sh, from frame 2); casa-pose (a RoboCasa robot carries a cereal box while
                  the camera moves: input with the box's mesh at our pose | the static kitchen with our camera path
                  and the box's, page_assets/robocasa_pose/ render_pose_clip.py); remove-car-roundabout (input |
                  without the dynamic Gaussians, render_removal.py); handobj-<clip> (five iPhone clips: input with our
                  hands and mesh outlines | MuJoCo, Hunyuan3D-2.1 meshes posed by their anchored tracks, round 6 of the
                  hand-object work, render_user5.py); handobj-hot3d-milk (HOT3D's milk carton from the Aria headset camera: input |
                  3D, HOT3D's scanned carton mesh at our pose and both WiLoR hands; the hand-object study's "after" recipe,
                  first 91 frames, cut before a fast spin makes the pose jump); all 12 fps; fridge-doors and casa-twin (30 fps): the
                  fridge.html and kitchen.html viewers' demos, one seamless loop each at the input camera's aspect,
                  recorded frame-exact with a virtual clock in a GPU headless Chrome (page_assets/viewer_pages/
                  record_viewer.py, record_native.sh); posters in img/apps/
  3d/             one file per Gallery run (4DReconstruction/scratchpad/page_assets/viewer/export_viewer.py): ~130k static
                  Gaussians fitted to the full model's renders, ~25k dynamic ones with their top-4 graph skinning,
                  the trained node tables, the input cameras, and the graph's edges, and in the header "tracks": the
                  dynamic Gaussians that get a 3D track (page_assets/viewer/pick_tracks.py, run on each file after
                  export); casa-twin.bin
                  (the RoboCasa kitchen twin, monocular) from page_assets/robocasa/mono_v4/ (export_viewer_parts_v4.py: static
                  Gaussians within 1.4 m of the camera path dropped; then rename_parts.py for the part names, the caps
                  after review (drawer 75 %, cabinets 30/41, fridge doors 17/19 degrees), microwave and dishwasher fixed); casa-pose.bin
                  (the cereal box, Gallery) from page_assets/robocasa_pose/ (export_viewer.py)
                  bmx-trees ... soapbox: the extended DAVIS runs (bench/scenes/DAVIS/d17h_<key>, gsplat_holdout), --fps 10;
                  breakdance, pigs and paragliding-launch from their retrains with a floor on gsplat's scene scale (bench_debug/ssfix/, update_run.py
                  in page_assets/viewer_pages/, which also re-cuts its clip): its camera barely moves, so the scale
                  (the cameras' extent) had frozen the means and capped every Gaussian near one pixel
    handobj/      the hand-object viewer's clips (clips.json, then per clip meta.json, poses/cams/joints/points/objN .bin,
                  objN.jpg textures, contours.json from the SAM 3 masks, frames_NN.jpg input atlases), from export_viewer.py
                  in the hand-object scratchpad (hoviewer_r6/tools/); hot3d-milk via its milk_to_r5.py adapter from the
                  hand-object study's recipe render (our XM camera, carton node and WiLoR hands; HOT3D's carton mesh), frames 0-90
```

## Filling in the skeleton

- **Links:** the Paper buttons (top bar and hero) point to arXiv:2611.07902; Code points to XM4D-release.
- **Venue, BibTeX:** see the `TODO` comments in `index.html`.
- **Teaser:** `div#teaser` above the top bar plays the teaser full screen, muted, with Pause and Sound buttons and a
  scroll cue (as on the GRASP page); main.js fades it as the page scrolls up over it and pauses it off screen. It holds
  on the first frame with a loading ring until it can play through (8 s buffered, or 3 s while the download runs at
  1.5x playback speed), steps down a cut (1440p, 1080p, 720p) when the download is slower than that, and shows the ring
  again whenever playback waits for data. The clips' posters below it (`data-poster`) load only once it has started,
  as each nears the screen.
  Upright phones show the whole frame at full width; ultra-wide screens show it whole, its sides fading out.
- **Method figures:** each `.step` has a `data-img` that the sticky stage shows while the step is active.
- **Articulated runs** (fridge.html, kitchen.html): a `.viewer` with `data-src` (and no run picker) shows one run; a run exported with
  `--hinges` (assets/3d/fridge.bin) is posed by one slider per part, which turns about its fitted hinge (or, for a
  `prismatic` part, slides along its axis). A part with `"fixed": true` keeps its frame-0 pose and gets no slider.
  With `data-part-views` on the `.viewer` (assets/3d/casa-twin.bin), the input view glides to the camera that saw each part open
  furthest, in the demo and when its slider is moved.
- **Gallery:** the clips (a `button[role=tab]` and a `.gallery-group` panel per run in `#runs`) and the 3D viewer below
  them have separate run lists; add an `<option value="<key>" data-src="assets/3d/<key>.bin">` to the viewer's
  (`#viewer-run`, above the viewer, tied to it by `data-for`). An option with `data-page` (the Applications group) shows
  that application's own 3D page, as it is, in the frame `#viewer-embed` in place of the viewer. Every run in the viewer's
  list has a clip; dog, mbike-trick, paragliding-launch, parkour, scooter-black and the NVIDIA runs have only clips.
- **3D tracks:** the viewer draws the file's stored tracks (pick_tracks.py): up to 110 dynamic Gaussians, spread out at
  frame 0, only ones the input video shows: in each frame's render from its own input camera, a Gaussian's blending
  weight must reach a quarter of the median of its own part's (main graph node's) visible Gaussians, in 60 % of the
  frames it is in view. Hidden ones (behind the body or the background) fall to ~0 and get none; a thin limb or a small,
  far-away body still counts (a depth test dropped parkour's legs, a run-wide weight dropped EgoDexter's hand). They must
  also be opaque, not tiny, in a dense part of the dynamic cloud, and no more jagged, relative to their speed, than 1.5
  times the run's median. Trails are drawn through a moving average over 2 frames either side (runs over 24 frames); the
  clips' tracks cell draws the first 60 the same way. A file without stored tracks falls back to
  the old in-browser choice. `data-tracks="off"` on an option shows none (truck).
