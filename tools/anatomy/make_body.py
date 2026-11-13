"""Generate a neutral human body with MPFB (MakeHuman, CC0 base mesh) and export it as GLB.
Usage: blender -b -P make_body.py -- <out.glb> <preview.png>
"""
import bpy, sys, addon_utils, math

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, PREVIEW = argv[0], argv[1]
SEX = argv[2] if len(argv) > 2 else "male"

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)

r = bpy.ops.mpfb.create_human()
print("create_human:", r)
objs = list(bpy.data.objects)
print("objects:", [(o.name, o.type, len(o.data.vertices) if o.type == "MESH" else 0) for o in objs])

body = max((o for o in objs if o.type == "MESH"), key=lambda o: len(o.data.vertices))
print("body:", body.name)

# Try to set a lean, athletic male build through MPFB's shape keys / attributes if exposed.
try:
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties
    MACROS = (("gender", 1.0), ("muscle", 0.78), ("weight", 0.42), ("height", 0.62), ("proportions", 0.9)) if SEX == "male" else (("gender", 0.0), ("muscle", 0.62), ("weight", 0.42), ("height", 0.5), ("proportions", 0.9), ("cupsize", 0.5), ("firmness", 0.6))
    for name, val in MACROS:
        try:
            HumanObjectProperties.set_value(name, val, entity_reference=body)
        except Exception as e:
            print("macro", name, e)
    TargetService.reapply_macro_details(body)
    print("macro applied:", {k: round(v, 2) for k, v in TargetService.get_macro_info_dict_from_basemesh(body).items() if isinstance(v, float)})
except Exception as e:
    print("macro service unavailable:", e)

# Remove helper geometry (clothes helpers, joint cubes) that MPFB keeps as hidden vertex groups.
bpy.context.view_layer.objects.active = body
for o in objs:
    o.select_set(o == body)
try:
    vg = [g for g in body.vertex_groups if g.name.lower().startswith(("helper", "joint"))]
    if vg:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
        idx = {g.index for g in vg}
        for v in body.data.vertices:
            v.select = any(g.group in idx for g in v.groups)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.delete(type="VERT")
        bpy.ops.object.mode_set(mode="OBJECT")
        print("removed helper groups:", len(vg))
except Exception as e:
    print("helper removal:", e)

# Bake shape keys / modifiers into plain geometry.
try:
    if body.data.shape_keys:
        body.shape_key_add(name="final", from_mix=True)
        keys = body.data.shape_keys.key_blocks
        for k in list(keys)[:-1]:
            body.shape_key_remove(k)
        body.shape_key_remove(body.data.shape_keys.key_blocks[0])
except Exception as e:
    print("shape keys:", e)
for m in list(body.modifiers):
    try:
        bpy.ops.object.modifier_apply(modifier=m.name)
    except Exception as e:
        print("modifier", m.name, e)
        body.modifiers.remove(m)

# Delete every other object (eyes, rig) - the app draws its own eyes/markers.
for o in list(bpy.data.objects):
    if o != body:
        bpy.data.objects.remove(o, do_unlink=True)
body.parent = None
body.data.materials.clear()
bpy.ops.object.shade_smooth()

dims = body.dimensions
print("dimensions (m):", tuple(round(d, 3) for d in dims), "verts:", len(body.data.vertices))

# Preview render
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        pass
mat = bpy.data.materials.new("clay")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.25, 0.32, 0.45, 1)
bsdf.inputs["Roughness"].default_value = 0.55
body.data.materials.append(mat)
cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
cz = body.location.z + dims.z / 2 if body.matrix_world.translation.z == 0 else dims.z / 2
bb = [body.matrix_world @ __import__("mathutils").Vector(c) for c in body.bound_box]
zmin, zmax = min(v.z for v in bb), max(v.z for v in bb)
cam.location = (0, -6.5, (zmin + zmax) / 2)
cam.rotation_euler = (math.radians(90), 0, 0)
cam_d.lens = 70
sc.camera = cam
light_d = bpy.data.lights.new("key", "AREA")
light_d.energy = 900
light_d.size = 3
light = bpy.data.objects.new("key", light_d)
light.location = (-2.5, -3.5, zmax + 1)
light.rotation_euler = (math.radians(55), 0, math.radians(-35))
sc.collection.objects.link(light)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.05, 0.09, 1)
sc.world = world
sc.render.resolution_x, sc.render.resolution_y = 500, 900
sc.render.filepath = PREVIEW
bpy.ops.render.render(write_still=True)

# Export without the preview material
body.data.materials.clear()
for o in list(bpy.data.objects):
    o.select_set(o == body)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                          export_normals=True, export_texcoords=False, export_materials="NONE",
                          export_draco_mesh_compression_enable=False)
print("EXPORTED", OUT)
