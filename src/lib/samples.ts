export type SampleProgram = {
  id: string;
  name: string;
  blurb: string;
  source: string;
};

export const SAMPLES: SampleProgram[] = [
  {
    id: "plate",
    name: "Rounded plate",
    blurb: "Clean millimeter contour and two bolt circles.",
    source: `; Northline sample — illustrative only, not a proven part program
; Millimeters. Do not run on a machine without your own setup check.
G21
G90
G17
G94
G91.1
G0 Z8
G0 X15 Y15
M3 S12000
G1 Z-1.5 F180
G1 X105 F700
G3 X115 Y25 I0 J10
G1 Y75
G3 X105 Y85 I-10 J0
G1 X15
G3 X5 Y75 I0 J-10
G1 Y25
G3 X15 Y15 I10 J0
G0 Z8
G0 X40 Y50
G1 Z-3 F160
G3 I8 J0 F500
G0 Z8
G0 X80 Y50
G1 Z-3 F160
G2 I-8 J0 F500
G0 Z8
G0 X0 Y0
M5
M30
`,
  },
  {
    id: "faults",
    name: "Fault fixture",
    blurb: "Unsupported cycle, bad arc, travel and feed issues.",
    source: `; Fault fixture — expect findings. Not a setup sheet.
G90
G0 X10 Y10
G0 Z-1
G0 X40
G1 X80
G81 X20 Y20 Z-8 R1 F100
G2 X30 Y30 R1
G0 X-20
G1 X500 F9000
M30
`,
  },
  {
    id: "inch",
    name: "Inch rectangle",
    blurb: "G20 absolute rectangle with an explicit spindle.",
    source: `; Inch sample. Profile travel is still stored in millimeters.
G20
G90
G17
G94
M3 S8000
G0 Z0.25
G0 X0.5 Y0.5
G1 Z-0.05 F8
G1 X2.0 F20
G1 Y1.5
G1 X0.5
G1 Y0.5
G0 Z0.25
M5
M30
`,
  },
];

export function sampleById(id: string): SampleProgram {
  return SAMPLES.find((s) => s.id === id) ?? SAMPLES[0];
}
