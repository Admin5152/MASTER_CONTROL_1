"""Build X-ray anatomy GLBs from BodyParts3D, fitted inside the MPFB bodies.
Usage: blender -b -P build_anatomy.py -- <bp3d_dir> <body3d_dir> <preview_dir>
Writes <body3d_dir>/anatomy_male.glb and anatomy_female.glb, plus preview PNGs.
"""
import bpy, bmesh, sys, os, json, re, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
BP, BODY, PREV = argv[0], argv[1], argv[2]
OBJDIR = os.path.join(BP, "obj", "partof_BP3D_4.0_obj_99")
idx = json.load(open(os.path.join(BP, "index.json")))

SKIP = r"muscle|tendon|ligament|fascia|aponeuros|nerve|ganglion|plexus|cartilage|meniscus|disc|gingiva|tooth|teeth|incisor|canine|molar|tongue|skin|fat|lymph|gland|bursa|capsule|retinaculum|auricle$|lip|eyelid|conjunctiva|meninx|dura|arachnoid|pia mater|ventricle of brain|lateral ventricle|third ventricle|fourth ventricle|choroid plexus|labrum|joint|pulp|enamel|dentin|spinal cord|cauda|hair|suspensory|pectoralis|oblique|rectus|levator|tensor|rhomboid|serratus|subclavius|transversus|trapezoid|anconeus|brachialis|coracobrach|piriformis|psoas|obturator|diaphragm|taenia|thymus|prostate|anterior chamber"
SKULL = r"frontal bone|parietal bone|temporal bone|occipital bone|sphenoid|ethmoid|zygomatic|maxilla|mandible|nasal bone|lacrimal|palatine|vomer|concha|hyoid|malleus|incus|stapes|skull|cranial"
GROUPS = [
    ("arteries", r"artery|arteri|aorta|arch of aorta|brachiocephalic trunk|coeliac trunk|celiac trunk|pulmonary trunk|arterial"),
    ("veins", r"vein|vena cava|venous|sinus|azygos|portal|plantar arch|venous arch"),
    ("brain", r"brain|cerebell|cerebr|gyrus|hemisphere|pons|medulla oblongata|midbrain|thalam|hippocamp|amygdala|caudate|putamen|pallid|corpus callosum|insula|cingulate|lobe$|occipital lobe|vermis|tectum|tegment|peduncle|fornix|hypothal|pituitary|claustrum|nucleus|colliculus|habenula|pineal|tuber cinereum|aqueduct"),
    ("eyes", r"sclera|vitreous|cornea|lens$|left lens|right lens|eyeball"),
    ("heart", r"heart|atrium|atrial|ventricle|myocard|valve|cusp|leaflet|papillary|trabecul|chordae|pericard|interventricular|interatrial|coronary sinus"),
    ("airway", r"trachea|bronch|larynx"),
    ("lungs", r"lung|lingula|pleura"),
    ("liver", r"liver|hepat|gall|cystic duct|bile"),
    ("stomach", r"stomach|gastric|esophag|duoden"),
    ("intestines", r"jejun|ileum|ileal|ileocecal|intestin|colon|cecum|caecum|appendix|rectum|anal"),
    ("pancreas_spleen", r"pancrea|spleen|splen"),
    ("kidneys", r"kidney|renal|ureter|bladder|urethra|adrenal|suprarenal"),
    ("skull", SKULL),
    ("spine", r"vertebra|atlas|axis|sacrum|coccyx"),
    ("ribcage", r"rib$|rib |ribs|sternum|manubrium|xiphoid|costal"),
    ("shoulders", r"clavicle|scapula"),
    ("pelvis", r"hip bone|ilium|ischium|pubis"),
    ("limbs", r"humerus|radius|ulna|carpal|scaphoid|lunate|triquetr|pisiform|trapezi|capitate|hamate|metacarp|phalan|femur|patella|tibia|fibula|talus|calcane|navicular|cuboid|cuneiform|metatars|sesamoid|bone"),
]
TARGET_TRIS = {"skull": 40000, "spine": 30000, "ribcage": 26000, "shoulders": 8000, "pelvis": 12000, "limbs": 50000,
               "brain": 45000, "eyes": 3000, "heart": 14000, "airway": 8000, "lungs": 24000, "liver": 8000,
               "stomach": 5000, "intestines": 16000, "pancreas_spleen": 3000, "kidneys": 6000,
               "arteries": 45000, "veins": 40000}
BONE_GROUPS = {"skull", "spine", "ribcage", "shoulders", "pelvis", "limbs"}


def classify(h):
    n = h.get("English name", "").lower()
    if not n or re.search(SKIP, n):
        return None
    for g, rx in GROUPS:
        if re.search(rx, n):
            return g
    return None


def is_arm(h, side):
    lo, hi = h["bmin"], h["bmax"]
    if lo[2] < 550 or hi[2] > 1345:
        return False
    return lo[0] >= 135 if side > 0 else hi[0] <= -135


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# 1. import and join per group; arm parts get their own groups so they can be rotated into the A-pose
buckets = {}
for h in idx:
    g = classify(h)
    if not g or "bmin" not in h:
        continue
    key = g
    for side, tag in ((1, "L"), (-1, "R")):
        if is_arm(h, side):
            key = f"{g}__arm{tag}"
    buckets.setdefault(key, []).append(h)
print("buckets:", {k: len(v) for k, v in sorted(buckets.items())})

objs = {}
for key, hs in buckets.items():
    parts = []
    for h in hs:
        before = set(bpy.data.objects)
        bpy.ops.wm.obj_import(filepath=os.path.join(OBJDIR, h["file"]), forward_axis="Y", up_axis="Z")
        parts += [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not parts:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = key
    o.data.name = key
    o.data.materials.clear()
    objs[key] = o
print("imported groups:", len(objs))

# mm -> m (obj importer keeps file units)
for o in objs.values():
    o.data.transform(Matrix.Scale(0.001, 4))
    o.data.update()

# 2. decimate each base group to its triangle budget (split across arm sub-buckets by share)
def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

base_tot = {}
for key, o in objs.items():
    base_tot[key.split("__")[0]] = base_tot.get(key.split("__")[0], 0) + tris(o)
for key, o in objs.items():
    g = key.split("__")[0]
    t = tris(o)
    budget = TARGET_TRIS[g] * t / max(base_tot[g], 1)
    if t > budget:
        m = o.modifiers.new("dec", "DECIMATE")
        m.ratio = max(budget / t, 0.02)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="dec")
    for p in o.data.polygons:
        p.use_smooth = True
print("tris after:", {k: tris(o) for k, o in sorted(objs.items())})


# ---- lungs: BodyParts3D has no lung parenchyma, so build them to fill the real ribcage ----
import numpy as np
def verts_np(o):
    a = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get("co", a); return a.reshape(-1, 3)
rib = verts_np(objs["ribcage"])
heart_v = verts_np(objs["heart"])
liver_v = verts_np(objs["liver"]) if "liver" in objs else None
stom_v = verts_np(objs["stomach"]) if "stomach" in objs else None
hmin, hmax = heart_v.min(0), heart_v.max(0)
z_top = rib[:, 2].max() - 0.01
z_base_r = (liver_v[:, 2].max() if liver_v is not None else hmin[2]) - 0.005
z_base_l = z_base_r - 0.015  # left dome of the diaphragm sits slightly lower
VOX = 0.011; NB = 48
def ring(z):
    for band in (0.012, 0.022, 0.035):
        sl = rib[np.abs(rib[:, 2] - z) < band]
        if len(sl) > 60: break
    if len(sl) < 20: return None
    cy = (sl[:, 1].min() + sl[:, 1].max()) / 2
    ang = np.arctan2(sl[:, 1] - cy, sl[:, 0]); rad = np.hypot(sl[:, 0], sl[:, 1] - cy)
    bins = ((ang + np.pi) / (2 * np.pi) * NB).astype(int) % NB
    r = np.full(NB, np.nan)
    for b in range(NB):
        m = bins == b
        if m.sum() >= 3: r[b] = np.percentile(rad[m], 25)
    good = ~np.isnan(r)
    if good.sum() < NB // 3: return None
    idxs = np.arange(NB); r = np.interp(idxs, idxs[good], r[good], period=NB)
    return cy, r
bm = bmesh.new()
count = 0
for z in np.arange(min(z_base_r, z_base_l), z_top, VOX):
    rg = ring(z)
    if rg is None: continue
    cy, r = rg
    apex = np.clip((z_top - z) / 0.06, 0.25, 1.0)  # taper at the apex
    for x in np.arange(-0.17, 0.17, VOX):
        side_base = z_base_r if x < 0 else z_base_l
        if z < side_base: continue
        if abs(x) < 0.028: continue  # mediastinum and spine
        for y in np.arange(-0.25, 0.10, VOX):
            a = np.arctan2(y - cy, x); b = int((a + np.pi) / (2 * np.pi) * NB) % NB
            if np.hypot(x, y - cy) > 0.86 * r[b] * apex: continue
            if hmin[0] - 0.012 < x < hmax[0] + 0.012 and hmin[1] - 0.012 < y < hmax[1] + 0.012 and z < hmax[2] + 0.012: continue
            if y > cy + 0.55 * r[b] and abs(x) < 0.05: continue  # behind: vertebral bodies
            bmesh.ops.create_cube(bm, size=VOX * 1.05, matrix=Matrix.Translation((x, y, z)))
            count += 1
me = bpy.data.meshes.new("lungs"); bm.to_mesh(me); bm.free()
lo = bpy.data.objects.new("lungs", me); sc.collection.objects.link(lo)
bpy.context.view_layer.objects.active = lo
for t, kw in (("REMESH", {"mode": "VOXEL", "voxel_size": 0.008}), ("SMOOTH", {"factor": 1.0, "iterations": 12}), ("DECIMATE", {"ratio": 1.0})):
    m = lo.modifiers.new(t, t)
    for k, v in kw.items(): setattr(m, k, v)
    if t == "REMESH": bpy.ops.object.modifier_apply(modifier=t)
    elif t == "SMOOTH": bpy.ops.object.modifier_apply(modifier=t)
    else:
        m.ratio = min(1.0, 22000 / max(1, sum(len(p.vertices) - 2 for p in lo.data.polygons))); bpy.ops.object.modifier_apply(modifier=t)
for p in lo.data.polygons: p.use_smooth = True
objs["lungs"] = lo
TARGET_TRIS["lungs"] = 22000
print("lungs: voxels", count, "tris", sum(len(p.vertices) - 2 for p in lo.data.polygons), "base R/L z", round(z_base_r, 3), round(z_base_l, 3), "top", round(z_top, 3))

# reference points in anatomy space (metres)
def bounds(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))), Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))

bone_objs = [o for k, o in objs.items() if k.split("__")[0] in BONE_GROUPS]
zs = [bounds(o) for o in bone_objs]
A_ZMIN = min(b[0].z for b in zs); A_ZMAX = max(b[1].z for b in zs)
rb = bounds(objs["ribcage"])
A_CHEST = (rb[0] + rb[1]) / 2
print("anatomy height (m):", round(A_ZMAX - A_ZMIN, 3), "ribcage centre:", tuple(round(c, 3) for c in A_CHEST))

# arm tips in anatomy space
def arm_tip(tag):
    vs = []
    for k, o in objs.items():
        if k.endswith("__arm" + tag) and k.split("__")[0] == "limbs":
            vs += [o.matrix_world @ v.co for v in o.data.vertices]
    return min(vs, key=lambda v: v.z) if vs else None

PIVOT = {"L": Vector((0.165, -0.075, 1.312)), "R": Vector((-0.165, -0.075, 1.312))}
TIP = {"L": arm_tip("L"), "R": arm_tip("R")}

# keep a pristine copy of the anatomy mesh data
base = {k: o.data.copy() for k, o in objs.items()}
for k, o in objs.items():
    o.name = k + '_src'


def load_body(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    b = [o for o in bpy.data.objects if o not in before and o.type == "MESH"][0]
    bpy.context.view_layer.update()
    return b


def fit(sex, glb):
    body = load_body(os.path.join(BODY, glb))
    bv = [body.matrix_world @ v.co for v in body.data.vertices]
    zmin = min(v.z for v in bv); zmax = max(v.z for v in bv)
    H = zmax - zmin
    s = H / (A_ZMAX - A_ZMIN)
    chest_z = zmin + 0.72 * H
    band = [v for v in bv if abs(v.z - chest_z) < 0.03 * H and abs(v.x) < 0.11 * H]
    yc = (min(v.y for v in band) + max(v.y for v in band)) / 2
    hw = max(abs(v.x) for v in band)
    # anatomy torso half-width at the same height ~ ribcage half-width * 1.18 (soft tissue)
    ax = s * (rb[1].x - rb[0].x) / 2 * 1.18
    kx = hw / ax
    print(sex, "height", round(H, 3), "scale", round(s, 4), "width factor", round(kx, 3))

    # body arm angle: hand tip (lowest vertex far from midline) relative to shoulder
    out = {}
    for tag, sgn in (("L", 1), ("R", -1)):
        hand = [v for v in bv if sgn * v.x > 0.2 * H]
        tip_b = min(hand, key=lambda v: v.z)
        piv_b = Vector((PIVOT[tag].x * s * kx, 0, zmin + (PIVOT[tag].z - A_ZMIN) * s))
        tip_a = Vector((TIP[tag].x * s * kx, 0, zmin + (TIP[tag].z - A_ZMIN) * s))
        a_body = math.atan2(tip_b.x - piv_b.x, -(tip_b.z - piv_b.z))
        a_anat = math.atan2(tip_a.x - piv_b.x, -(tip_a.z - piv_b.z))
        out[tag] = (piv_b, a_body - a_anat)
        print(sex, "arm", tag, "rotate deg", round(math.degrees(a_body - a_anat), 1))

    coll = bpy.data.collections.new("anatomy_" + sex)
    sc.collection.children.link(coll)
    made = []
    for k, data in base.items():
        me = data.copy()
        M = (Matrix.Translation(Vector((0, yc - (A_CHEST.y * s), zmin - A_ZMIN * s)))
             @ Matrix.Diagonal(Vector((s * kx, s * kx, s, 1))))
        me.transform(M)
        if "__arm" in k:
            tag = k[-1]
            piv, ang = out[tag]
            R = Matrix.Translation(piv) @ Matrix.Rotation(-ang, 4, "Y") @ Matrix.Translation(-piv)
            me.transform(R)
        elif k in ("arteries", "veins"):
            # vessels that run from the shoulder into the arm: rotate the arm-side vertices only
            src = data.vertices
            for tag, sgn in (("L", 1), ("R", -1)):
                piv, ang = out[tag]
                R = Matrix.Translation(piv) @ Matrix.Rotation(-ang, 4, "Y") @ Matrix.Translation(-piv)
                a0 = PIVOT[tag]; a1 = TIP[tag]; ax = (a1 - a0); L2 = ax.length_squared
                for i, v in enumerate(src):
                    c = v.co
                    if sgn * c.x < 0.135 or c.z > 1.335 or c.z < 0.55: continue
                    t = max(0.0, min(1.0, (c - a0).dot(ax) / L2))
                    if (c - (a0 + ax * t)).length < 0.065:
                        me.vertices[i].co = R @ me.vertices[i].co
            # remove faces torn across the rotated/unrotated boundary (vessel edges are short)
            bm2 = bmesh.new(); bm2.from_mesh(me)
            torn = [f for f in bm2.faces if any(e.calc_length() > 0.035 for e in f.edges)]
            bmesh.ops.delete(bm2, geom=torn, context="FACES")
            print("  removed torn faces in", k, len(torn))
            bm2.to_mesh(me); bm2.free()
        name = k.split("__")[0] + ("_arm" + k[-1] if "__arm" in k else "")
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        made.append(ob)
    # merge arm pieces back into their group objects for a clean node list
    groups = sorted({m.name.split("_arm")[0].split(".")[0] for m in made})
    for g in groups:
        parts = [m for m in coll.objects if m.name.split("_arm")[0].split(".")[0] == g]
        bpy.ops.object.select_all(action="DESELECT")
        for p in parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        if len(parts) > 1:
            bpy.ops.object.join()
        bpy.context.view_layer.objects.active.name = g
    return body, coll


def render_preview(body, coll, path):
    for o in sc.objects:
        o.hide_render = True
    body.hide_render = False
    for o in coll.objects:
        o.hide_render = False
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            pass

    def emit(name, col, strength, alpha=None):
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs[0].default_value = col
        em.inputs[1].default_value = strength
        if alpha is None:
            nt.links.new(em.outputs[0], out.inputs[0])
        else:
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            lw = nt.nodes.new("ShaderNodeLayerWeight")
            lw.inputs[0].default_value = alpha
            mix = nt.nodes.new("ShaderNodeMixShader")
            nt.links.new(lw.outputs["Facing"], mix.inputs[0])
            nt.links.new(tr.outputs[0], mix.inputs[1])
            nt.links.new(em.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs[0])
            try:
                m.surface_render_method = "BLENDED"
            except Exception:
                pass
        return m

    cols = {"skull": (0.85, 0.92, 1, 1), "spine": (0.85, 0.92, 1, 1), "ribcage": (0.85, 0.92, 1, 1), "shoulders": (0.85, 0.92, 1, 1),
            "pelvis": (0.85, 0.92, 1, 1), "limbs": (0.85, 0.92, 1, 1), "brain": (1, 0.55, 0.6, 1), "eyes": (0.6, 0.9, 1, 1),
            "heart": (1, 0.2, 0.25, 1), "lungs": (0.4, 0.75, 1, 1), "airway": (0.5, 0.8, 1, 1), "liver": (0.8, 0.35, 0.3, 1),
            "stomach": (1, 0.6, 0.4, 1), "intestines": (1, 0.7, 0.5, 1), "pancreas_spleen": (0.9, 0.6, 0.5, 1),
            "kidneys": (0.9, 0.45, 0.4, 1), "arteries": (1, 0.15, 0.2, 1), "veins": (0.25, 0.45, 1, 1)}
    for o in coll.objects:
        o.data.materials.clear()
        g = o.name.split(".")[0]
        o.data.materials.append(emit("m_" + g, cols.get(g, (1, 1, 1, 1)), 1.6 if g in BONE_GROUPS else 1.2))
    body.data.materials.clear()
    body.data.materials.append(emit("m_body", (0.3, 0.6, 1, 1), 1.5, alpha=0.25))
    w = bpy.data.worlds.get("w") or bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.01, 0.015, 0.03, 1)
    sc.world = w
    cam = bpy.data.objects.get("cam")
    if not cam:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    bv = [body.matrix_world @ v.co for v in body.data.vertices]
    zmin = min(v.z for v in bv); zmax = max(v.z for v in bv)
    cam.data.ortho_scale = (zmax - zmin) * 1.08
    cam.location = (0, -6, (zmin + zmax) / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 560, 900
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # side view
    cam.location = (6, 0, (zmin + zmax) / 2)
    cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    sc.render.filepath = path.replace(".png", "_side.png")
    bpy.ops.render.render(write_still=True)


for sex, glb in (("male", "human.glb"), ("female", "human_female.glb")):
    body, coll = fit(sex, glb)
    # export anatomy only, no materials, Draco-compressed
    bpy.ops.object.select_all(action="DESELECT")
    for o in coll.objects:
        o.data.materials.clear()
        o.select_set(True)
    bpy.context.view_layer.objects.active = list(coll.objects)[0]
    out = os.path.join(BODY, f"anatomy_{sex}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=True,
                              export_normals=True, export_texcoords=False, export_materials="NONE",
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print("EXPORTED", out, os.path.getsize(out) // 1024, "kB", "nodes:", sorted(o.name for o in coll.objects))
    for o in list(coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.objects.remove(body, do_unlink=True)
print("ALL DONE")
