const fs = require('fs');

const catalog = JSON.parse(fs.readFileSync('c:/Users/USER/OneDrive/Desktop/MASTER_CONTROL_1/dataset/_catalog.json', 'utf8'));

const owners = { P1: [], P2: [], P3: [], P4: [], P5: [], P6: [] };
catalog.forEach(item => {
  const o = item.primaryOwner || 'P6';
  if (owners[o]) owners[o].push(item);
});

let md = '# NASA Spaceflight Medical Dataset & MRID Assignment Directory\n\n';
md += '**NASA JSC 28913 Medical Requirements Integration Documents (MRIDs)**\n';
md += 'This directory contains the clinical standards, monitoring procedures, and baseline physiological thresholds used by NASA for astronaut medical management. The catalog maps all 68 unique documents (94 PDF files including duplicates) to the 6 feature owners.\n\n';

md += '## Ownership Summary\n\n';
md += '| Owner | Feature Module | Assigned MRIDs | Focus Area |\n';
md += '| --- | --- | --- | --- |\n';
md += '| **Person 1** | Radiation Awareness | 11 files | Area dosimeters, TEPC, intravehicular monitors, space radiation limits |\n';
md += '| **Person 2** | Body Model & Zones | 19 files | Physical exams, dental, vision/eyes, bone density, body mass, MRI, skin |\n';
md += '| **Person 3** | Face, AI Model & Voice | 2 files | Neurological evaluation, hearing conservation & acoustics |\n';
md += '| **Person 4** | Vitals & Check-in | 17 files | Clinical labs, ECG, exercise treadmill, handgrip, fitness evaluation |\n';
md += '| **Person 5** | Lonely Games & Wellbeing | Research Base | NASA Space Gardening research, HRP Behavioral Health & Performance, isolation analogs |\n';
md += '| **Person 6** | Dataset & Integration | 19 files | Air quality, water quality, toxicology, EVA prebreathe protocols, mission operations |\n\n';

md += '## How to Use Your Assigned Documents in the Codebase\n\n';
md += '1. **Extract Reference Ranges:** Open your PDFs and locate normal resting ranges and alarm limits. Place them into `shared/thresholds.json` citing the MRID document number.\n';
md += '2. **Extract Measurement Instructions:** Find the clinical equipment and measurement technique. Place this into `shared/facts.json` under `"how_to_measure"` so astronauts see clear instructions on their screens.\n';
md += '3. **Extract Clinical Rationale:** Extract the physiological risk explanation. Place this into `shared/facts.json` under `"why_it_matters"` linked to NASA HRP risks.\n';
md += '4. **Cite Sources:** Add every referenced MRID to `shared/SOURCES.md`.\n\n';

const titleMap = {
  P1: 'Person 1: Radiation Awareness (11 Documents)',
  P2: 'Person 2: Body Model & Anatomical Zones (19 Documents)',
  P3: 'Person 3: Face, AI Model & Voice (2 Documents)',
  P4: 'Person 4: Vitals & Check-in (17 Documents)',
  P6: 'Person 6: Dataset, Core Engine & Integration (19 Documents)'
};

['P1', 'P2', 'P3', 'P4', 'P6'].forEach(owner => {
  md += '### ' + titleMap[owner] + '\n\n';
  md += '| PDF Filename | Document Title / Description | Confidence | Duplicates in Folder |\n';
  md += '| --- | --- | --- | --- |\n';
  owners[owner].forEach(item => {
    const cleanTitle = (item.title || 'General NASA Medical Requirement').replace(/\r?\n/g, ' ').trim();
    const dups = item.duplicates && item.duplicates.length > 0 ? item.duplicates.join(', ') : 'None';
    md += '| `' + item.file + '` | ' + cleanTitle + ' | ' + item.confidence + ' | ' + dups + ' |\n';
  });
  md += '\n';
});

md += '### Person 5: Lonely Games & Wellbeing Experiences (Evidence Base)\n\n';
md += 'No NASA MRIDs govern entertainment or games directly. Instead, Person 5 builds from the following NASA Human Research Program (HRP) published evidence:\n\n';
md += '- **NASA Space Gardening & Plant Growth Research:** Evidence that caring for living systems in space directly mitigates isolation, confinement, and monotony. Informs the **Hydroponic Greenhouse** (`app/js/wellbeing/greenhouse.js`).\n';
md += '- **HRP Risk of Behavioral Changes & Psychiatric Disorders:** Establishes the requirement for daily behavioral countermeasures, active mental breaks, and biofeedback-assisted autonomic regulation. Informs **Orb Calm** (`app/js/wellbeing/orbcalm.js`) and **Space Race (Aurora Run)** (`app/js/wellbeing/race/`).\n';
md += '- **Isolation Analog Protocols (HERA, NEK, HI-SEAS):** Operational research showing that self-reported mood tracking before and after breaks helps individuals identify and manage psychological drift.\n\n';

fs.writeFileSync('c:/Users/USER/OneDrive/Desktop/MASTER_CONTROL_1/dataset/README.md', md, 'utf8');
console.log('dataset/README.md generated successfully, length:', md.length);
