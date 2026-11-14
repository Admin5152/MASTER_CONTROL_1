"""Organ card thumbnails (brief section 10 items 1 and 3): realistic renders of the real anatomy nodes.

    blender -b -P tools/anatomy/render_organs.py -- app/assets/body3d/anatomy_male.glb app/assets/organs

Imports the Draco-compressed anatomy, gives each organ a realistic lit material (heart deep red with
sheen, lungs soft blue, brain pink-grey, bones ivory, vessels red and blue), and renders one PNG per
organ card on a transparent background. Source: BodyParts3D (DBCLS, CC BY 4.0); the lungs are a fitted
approximation (see tools/anatomy/README.md).
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = Path(args[0] if args else "app/assets/body3d/anatomy_male.glb")
OUT = Path(args[1] if len(args) > 1 else "app/assets/organs")
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 512

CARDS = {
    "heart": (["heart"], (0.0, -1.0, 0.12)),
    "lungs": (["lungs", "airway"], (0.0, -1.0, 0.05)),
    "brain": (["brain"], (-0.55, -0.85, 0.35)),
    "eyes": (["eyes", "skull"], (0.0, -1.0, 0.05)),
    "gut": (["stomach", "intestines", "liver", "pancreas_spleen"], (0.0, -1.0, 0.08)),
    "bones": (["skull", "spine", "ribcage", "shoulders", "pelvis", "limbs"], (0.0, -1.0, 0.0)),
}
LOOK = {
    "heart": dict(color=(0.42, 0.03, 0.04), rough=0.38, sheen=0.6, sss=0.25, sss_col=(0.9, 0.15, 0.1)),
    "lungs": dict(color=(0.32, 0.55, 0.85), rough=0.55, sheen=0.4, sss=0.3, sss_col=(0.5, 0.75, 1.0)),
    "airway": dict(color=(0.75, 0.42, 0.42), rough=0.45, sheen=0.2, sss=0.2, sss_col=(1.0, 0.6, 0.6)),
    "brain": dict(color=(0.78, 0.58, 0.6), rough=0.5, sheen=0.3, sss=0.35, sss_col=(1.0, 0.7, 0.7)),
    "eyes": dict(color=(0.9, 0.92, 0.95), rough=0.15, sheen=0.1, sss=0.2, sss_col=(1, 1, 1)),
    "stomach": dict(color=(0.85, 0.45, 0.4), rough=0.45, sheen=0.3, sss=0.3, sss_col=(1.0, 0.6, 0.5)),
    "intestines": dict(color=(0.86, 0.55, 0.45), rough=0.45, sheen=0.3, sss=0.3, sss_col=(1.0, 0.7, 0.55)),
    "liver": dict(color=(0.42, 0.12, 0.1), rough=0.4, sheen=0.3, sss=0.2, sss_col=(0.8, 0.25, 0.2)),
    "pancreas_spleen": dict(color=(0.6, 0.3, 0.3), rough=0.45, sheen=0.2, sss=0.2, sss_col=(0.9, 0.5, 0.4)),
    "bone": dict(color=(0.86, 0.8, 0.66), rough=0.55, sheen=0.1, sss=0.1, sss_col=(1.0, 0.95, 0.8)),
}
BONES = {"skull", "spine", "ribcage", "shoulders", "pelvis", "limbs"}


def material(name, look):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (*look["color"], 1)
    p.inputs["Roughness"].default_value = look["rough"]
    for key, val in (("Sheen Weight", look["sheen"]), ("Subsurface Weight", look["sss"]), ("Coat Weight", 0.15)):
        if key in p.inputs:
            p.inputs[key].default_value = val
    if "Subsurface Radius" in p.inputs:
        p.inputs["Subsurface Radius"].default_value = look["sss_col"]
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SRC))
parts = {o.name.split(".")[0]: o for o in bpy.context.scene.objects if o.type == "MESH"}
for name, o in parts.items():
    look = LOOK["bone"] if name in BONES else LOOK.get(name, LOOK["stomach"])
    o.data.materials.clear()
    o.data.materials.append(material(f"m_{name}", look))
    for poly in o.data.polygons:
        poly.use_smooth = True

scene = bpy.context.scene
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
if scene.render.engine == "CYCLES":
    scene.cycles.samples = 48
    scene.cycles.device = "CPU"
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
try:
    scene.view_settings.view_transform = "Standard"
except TypeError:
    pass

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.55, 0.6, 0.7, 1)
bg.inputs["Strength"].default_value = 0.6

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.lens = 85
scene.collection.objects.link(cam)
scene.camera = cam
lights = []
for loc, energy, size in (((-1.5, -2.0, 2.0), 260, 1.5), ((2.0, -1.0, 0.8), 120, 1.2), ((0.5, 2.0, 1.5), 200, 1.0)):
    L = bpy.data.objects.new("l", bpy.data.lights.new("l", "AREA"))
    L.data.energy = energy
    L.data.size = size
    scene.collection.objects.link(L)
    lights.append((L, Vector(loc)))

for card, (names, view) in CARDS.items():
    keep = [parts[n] for n in names if n in parts]
    for o in parts.values():
        o.hide_render = o not in keep
    pts = [o.matrix_world @ Vector(c) for o in keep for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center, size = (lo + hi) / 2, max((hi - lo).x, (hi - lo).y, (hi - lo).z)
    d = Vector(view).normalized()
    dist = size / (2 * math.tan(cam.data.angle / 2)) * 1.25
    cam.location = center + d * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    for L, loc in lights:
        L.location = center + loc * size * 2.2
        L.rotation_euler = (center - L.location).to_track_quat("-Z", "Y").to_euler()
        L.data.energy = L.data.energy if card == "heart" else L.data.energy
    for L, _ in lights:
        L.data.size = size * 1.5
    scene.render.filepath = str(OUT / f"{card}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", OUT / f"{card}.png", scene.render.engine)
