"""Space race assets, built in Blender 5.2 headless (brief section 7 item 4). Original designs.

    blender -b -P tools/game/make_game_assets.py -- app/assets/game

Writes racer.glb (the player's ship; the ghost racers reuse it in other colours), gate.glb (checkpoint
ring), pickup.glb (power-up capsule) and asteroid.glb. Materials are named so three.js can recolour
them: hull, accent, glass, engine_glow, gate_frame, gate_light, pickup_shell, pickup_core, rock.
Orientation: the ship's nose points along glTF +Z (Blender -Y), up is +Y.
"""
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy

OUT = Path(sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "app/assets/game")
OUT.mkdir(parents=True, exist_ok=True)
random.seed(7)


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials):
        for b in list(block):
            block.remove(b)


def mat(name, color, metallic=0.0, rough=0.4, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = rough
    if emit is not None:
        for key in ("Emission Color", "Emission"):
            if key in p.inputs:
                p.inputs[key].default_value = (*emit, 1)
                break
        p.inputs["Emission Strength"].default_value = strength
    return m


def assign(obj, m):
    obj.data.materials.clear()
    obj.data.materials.append(m)


def smooth(obj, level=1):
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if level:
        mod = obj.modifiers.new("sub", "SUBSURF")
        mod.levels = level
        mod.render_levels = level


def join(objs, name):
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def export(name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(OUT / f"{name}.glb"), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
    print("wrote", OUT / f"{name}.glb")


def edit(obj, fn):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        fn(v.co)
    bm.to_mesh(obj.data)
    bm.free()


# ---------------- racer ----------------
reset()
hull = mat("hull", (0.86, 0.89, 0.94), 0.55, 0.28)
accent = mat("accent", (0.1, 0.75, 1.0), 0.2, 0.35)
glass = mat("glass", (0.02, 0.05, 0.12), 0.9, 0.05)
glow = mat("engine_glow", (0.4, 0.85, 1.0), 0, 0.5, emit=(0.4, 0.85, 1.0), strength=6.0)
parts = []

bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1)
f = bpy.context.active_object
f.scale = (0.34, 1.45, 0.2)
bpy.ops.object.transform_apply(scale=True)


def nose(co):
    if co.y < 0:
        k = 1 - min(1.0, -co.y / 1.45) * 0.55
        co.x *= k
        co.z *= 0.6 + 0.4 * k


edit(f, nose)
assign(f, hull); smooth(f); parts.append(f)

bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1, location=(0, -0.35, 0.16))
c = bpy.context.active_object
c.scale = (0.17, 0.48, 0.12)
assign(c, glass); smooth(c); parts.append(c)

for s in (-1, 1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(s * 0.75, 0.45, -0.02))
    w = bpy.context.active_object
    w.scale = (0.9, 0.55, 0.04)
    bpy.ops.object.transform_apply(scale=True, location=False)

    def sweep(co, s=s):
        out = co.x * s / 0.9 + 0.5            # 0 at the root, 1 at the tip
        co.y += out * 0.55
        if out > 0.5:
            co.y -= (co.y - 0.2) * (out - 0.5) * 0.7

    edit(w, sweep)
    assign(w, hull); parts.append(w)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(s * 1.2, 0.95, -0.02))
    t = bpy.context.active_object
    t.scale = (0.08, 0.42, 0.07)
    assign(t, accent); parts.append(t)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.13, depth=0.7, location=(s * 0.3, 1.15, 0.0), rotation=(math.pi / 2, 0, 0))
    e = bpy.context.active_object
    assign(e, hull); smooth(e, 0); parts.append(e)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.105, depth=0.06, location=(s * 0.3, 1.51, 0.0), rotation=(math.pi / 2, 0, 0))
    g = bpy.context.active_object
    assign(g, glow); parts.append(g)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 1.0, 0.28))
fin = bpy.context.active_object
fin.scale = (0.03, 0.45, 0.26)
bpy.ops.object.transform_apply(scale=True, location=False)


def rake(co):
    if co.z > 0:
        co.y += 0.35


edit(fin, rake)
assign(fin, accent); parts.append(fin)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.2, 0.19))
st = bpy.context.active_object
st.scale = (0.05, 0.9, 0.02)
assign(st, accent); parts.append(st)
ship = join(parts, "racer")
ship.scale = (0.5, 0.5, 0.5)
export("racer")

# ---------------- checkpoint gate ----------------
reset()
frame = mat("gate_frame", (0.7, 0.76, 0.86), 0.7, 0.3)
light = mat("gate_light", (0.45, 0.9, 1.0), 0, 0.4, emit=(0.45, 0.9, 1.0), strength=4.0)
bpy.ops.mesh.primitive_torus_add(major_radius=3.0, minor_radius=0.16, major_segments=96, minor_segments=16, rotation=(math.pi / 2, 0, 0))
t = bpy.context.active_object
assign(t, frame)
bpy.ops.mesh.primitive_torus_add(major_radius=2.78, minor_radius=0.04, major_segments=96, minor_segments=8, rotation=(math.pi / 2, 0, 0))
t2 = bpy.context.active_object
assign(t2, light)
pods = []
for i in range(8):
    a = i / 8 * math.tau
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * 3.0, 0, math.sin(a) * 3.0), rotation=(0, -a, 0))
    p = bpy.context.active_object
    p.scale = (0.5, 0.42, 0.3)
    assign(p, frame); pods.append(p)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * 3.0, -0.22, math.sin(a) * 3.0), rotation=(0, -a, 0))
    q = bpy.context.active_object
    q.scale = (0.3, 0.02, 0.12)
    assign(q, light); pods.append(q)
join([t, t2] + pods, "gate")
export("gate")

# ---------------- power-up capsule ----------------
reset()
shell = mat("pickup_shell", (0.75, 0.9, 1.0), 0.1, 0.05)
core = mat("pickup_core", (1, 1, 1), 0, 0.5, emit=(1, 1, 1), strength=5.0)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.75)
s = bpy.context.active_object
assign(s, shell)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.36)
k = bpy.context.active_object
assign(k, core); smooth(k, 0)
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.05, major_segments=64, minor_segments=8)
r = bpy.context.active_object
assign(r, core)
join([s, k, r], "pickup")
export("pickup")

# ---------------- asteroid ----------------
reset()
rock = mat("rock", (0.36, 0.33, 0.31), 0.0, 0.92)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1)
a = bpy.context.active_object
seeds = [(random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1)) for _ in range(9)]


def lumpy(co):
    d = sum(0.11 * math.exp(-((co.x - x) ** 2 + (co.y - y) ** 2 + (co.z - z) ** 2) * 6) for x, y, z in seeds)
    n = 1 - d + 0.035 * math.sin(co.x * 9) * math.sin(co.y * 7 + 1) + random.uniform(-0.02, 0.02)
    co *= n


edit(a, lumpy)
a.scale = (1.0, 0.8, 0.9)
assign(a, rock)
smooth(a, 0)
export("asteroid")
