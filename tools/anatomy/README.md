# Body and anatomy assets

- `make_body.py` generates `app/assets/body3d/human.glb` (male) and `human_female.glb` with MakeHuman/MPFB in Blender 5.2 (CC0 base mesh):
  `blender -b -P make_body.py -- <out.glb> <preview.png> [male|female]`
- `build_anatomy.py` builds `anatomy_male.glb` and `anatomy_female.glb` from BodyParts3D (download `partof_BP3D_4.0_obj_99.zip` and `partof_parts_list_e.txt` from https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html, unzip into `<bp3d>/obj/`, then run `classify.py`-style indexing to make `index.json`):
  `blender -b -P build_anatomy.py -- <bp3d_dir> app/assets/body3d <preview_dir>`
  It imports about 1,100 parts, groups them into 18 named systems, decimates them to a browser budget, fits them to each body (height scale, torso width, arms rotated into the A-pose) and exports Draco-compressed GLB.
- BodyParts3D has no lung parenchyma, so `lungs` is generated from the real ribcage interior (voxelised, remeshed, smoothed). It is an approximation, not scan data.
- The BodyParts3D source specimen is an adult male. The female anatomy is the same anatomy fitted to the female body; say so if asked.

Credits: BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution 4.0 International (older files state CC BY-SA 2.1 Japan). Body base mesh: MakeHuman / MPFB, CC0.
