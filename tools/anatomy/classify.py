import json, re, collections
idx = json.load(open("index.json"))
R = [
 ("skip", r"muscle|tendon|ligament|fascia|aponeuros|nerve|ganglion|plexus|cartilage|meniscus|disc|gingiva|tooth|teeth|incisor|canine|molar|premolar|tongue|skin|fat|lymph|gland|bursa|capsule|membrane of|retinaculum|septum of nose|nasal cartilage|auricle|lip|eyelid|conjunctiva|lens|cornea|iris|retina|choroid|vitreous|sclera|ciliary|meninx|dura|arachnoid|pia|ventricle of brain|lateral ventricle|third ventricle|fourth ventricle|choroid plexus|semilunar|labrum|joint|pulp|enamel|dentin|root of|spinal cord|cauda"),
 ("vessels", r"artery|arteri|aorta|vein|vena cava|venous|sinus of dura|sagittal sinus|transverse sinus|sigmoid sinus|arch of|trunk$|brachiocephalic|azygos|portal"),
 ("brain", r"brain|cerebell|cerebr|gyrus|lobe of (right|left) cerebral|hemisphere|pons|medulla oblongata|midbrain|thalam|hippocamp|amygdala|caudate nucleus|putamen|pallidus|corpus callosum|insula|cingulate|frontal lobe|parietal lobe|temporal lobe|occipital lobe|vermis|tectum|tegmentum|peduncle|fornix|hypothal|pituitary|claustrum|nucleus"),
 ("heart", r"heart|atrium|atrial|ventricle|myocard|valve|auricle of|cusp|papillary|trabecul|chordae|pericard|interventricular|interatrial|conus arteriosus|sinus venarum"),
 ("lungs", r"lung|bronch|trachea|lobe of (right|left) lung|segment of (right|left) lung|pleura|lingula"),
 ("digestive", r"liver|hepat|stomach|gastric|esophag|duoden|jejun|ileum|ileal|intestin|colon|cecum|caecum|appendix|rectum|anal|pancrea|gall|bile|spleen|splen|pharynx|sigmoid colon"),
 ("urinary", r"kidney|renal|ureter|bladder|urethra|adrenal|suprarenal"),
 ("eyes", r"eyeball|eye ball|optic"),
 ("bones", r"bone|vertebra|atlas|axis|sacrum|coccyx|rib|sternum|manubrium|xiphoid|clavicle|scapula|humerus|radius|ulna|carpal|scaphoid|lunate|triquetr|pisiform|trapezi|capitate|hamate|metacarp|phalan|femur|patella|tibia|fibula|talus|calcane|navicular|cuboid|cuneiform|metatars|sesamoid|mandible|maxilla|skull|cranium|cranial|hyoid|ilium|ischium|pubis|ossicle|malleus|incus|stapes|vomer|turbinate|concha|occipital|parietal|frontal|temporal|sphenoid|ethmoid|zygomatic|palatine|lacrimal|nasal"),
]
by = collections.defaultdict(list)
for h in idx:
    n = h.get("English name", "").lower()
    cat = next((c for c, rx in R if re.search(rx, n)), "unmatched")
    by[cat].append(h)
for c in ["bones","brain","heart","lungs","digestive","urinary","eyes","vessels","skip","unmatched"]:
    hs = by[c]; print(f"{c:10s} {len(hs):4d} parts {sum(h['kb'] for h in hs)/1024:6.1f} MB")
print("\nunmatched sample:", "; ".join(sorted(h["English name"] for h in by["unmatched"])[:80]))
print("\neyes:", "; ".join(h["English name"] for h in by["eyes"]))
print("\nheart:", "; ".join(h["English name"] for h in by["heart"])[:900])
print("\nbrain:", "; ".join(h["English name"] for h in by["brain"])[:900])
json.dump({c: [h["file"] for h in v] for c, v in by.items()}, open("systems.json", "w"))
