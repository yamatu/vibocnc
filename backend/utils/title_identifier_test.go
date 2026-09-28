package utils

import (
	"strconv"
	"testing"
)

// TestExtractTitleIdentifierCoversTheOmronImportQueue is a regression table taken
// from the production import queue.
//
// 61 drafts sat unreviewable with "no model or part number" while every one of
// these titles named its part in the first eight words. The titles are copied
// verbatim, markup and glued eBay UI text included, so a future change to the
// family tables or to the markup stripping has to keep parsing the real rows.
func TestExtractTitleIdentifierCoversTheOmronImportQueue(t *testing.T) {
	cases := []struct {
		id    uint
		title string
		want  string
	}{
		{130158, "CJ1W-ID262 Omron PLC module CJ1W-ID262 Brand New In Box", "CJ1W-ID262"},
		{130159, "1pcs New Omron G7SA-2A2B G7SA2A2B safety relay US Free TAXOpens in a new window or tab", "G7SA-2A2B"},
		{130161, "NX-SOD400 New In Box Original Omron NX-SOD400 Safety Output Unit NXSOD400", "NX-SOD400"},
		{130162, "Omron CJ1W-AD081-V1 PLC Module CJ1WAD081V1 One Year Warranty US Free TAX", "CJ1W-AD081-V1"},
		{130168, "OMRON CJ1W-DA021 PLC Module CJ1WDA021 In Box Fast Shipping", "CJ1W-DA021"},
		{130174, "Omron SRT2-ROC16 PLC Module New One Fast Shipping SRT2ROC16 US Free TAX", "SRT2-ROC16"},
		{130175, "1PC New Omron DRT2-MD16 PLC Module DRT2MD16 In Box Fast Shipping", "DRT2-MD16"},
		{130177, "1 PCS NEW IN BOX OMRON Digital Unit NX-RS1201 NX-RS1201 FAST SHIP US Free TAX", "NX-RS1201"},
		{130185, "1PC New IN BOX OMRON D4NL-1DFA-B Guard Lock Safety-Door Switch US Free TAX", "D4NL-1DFA-B"},
		{130186, "1 year warranty New in box Omron Brand New Timer H3CA-A H3CAA 24-240VAC/VDC", "H3CA-A"},
		{130189, "Omron G9SA-321-T075 Safety Relay Unit New In Box US Free TAX", "G9SA-321-T075"},
		{130190, "Omron SRT2-ID16-1 PLC Module New One Free Shipping SRT2ID161 US Free TAX", "SRT2-ID16-1"},
		{130191, "1PCS Brand NEW Omron PLC module SRT2-ID16T SRT2ID16T Fast Ship US Free TAX", "SRT2-ID16T"},
		{130192, "OMRON E3FA-DN12 Photoelectric Sensor E3FADN12 Fast Shipping New In Box", "E3FA-DN12"},
		{130193, "New NT31-ST123-EV3 Omron Touch Screen PLC Module in box", "NT31-ST123-EV3"},
		{130194, "1PC Omron NB10W-TW01B Touch Screen New In Box Fast Shipping NB10WTW01B", "NB10W-TW01B"},
		{130195, "OMRON E3X-MDA11 Sensor E3XMDA11 New In Box Fast Shipping", "E3X-MDA11"},
		{130196, "1PC Omron E3X-NA41 Photoelectric Sensor E3XNA41 New Fast Shipping US Free TAX", "E3X-NA41"},
		{130197, "1PC OMRON H5CX-L8D-N H5CXL8DN Timer Unit New In Box Fast Shipping", "H5CX-L8D-N"},
		{130198, "New In Box OMRON E5CSV-R1T Temperature Controller", "E5CSV-R1T"},
		{130201, "1PC New Omron W4S1-03B PLC Module In Box Free Shipping W4S103B", "W4S1-03B"},
		{130204, "1PCS New in Box OMRON E3NX-FA11 1 year warranty", "E3NX-FA11"},
		{130206, "Omron E5CK-AA1 Temperature Controller New One Free Shipping E5CKAA1", "E5CK-AA1"},
		{130207, "1PC New Omron H3CR-F8 PLC Twin Timer 100-240V AC Free Shipping US Free TAX", "H3CR-F8"},
		{130209, "Omron CJ1W-AD04U PLC Module CJ1WAD04U New In Box Fast Ship 1PCS", "CJ1W-AD04U"},
		{130212, "One New Omron S8VK-C12024 Switching Power Supply 100-240VAC In Box US Free TAX", "S8VK-C12024"},
		{130213, "1PC New Omron R88D-GP08H Servo Drive In Box Fast Shipping", "R88D-GP08H"},
		{130214, "New Original Omron PLC module NJ501-1300 CPU Unit NJ5011300", "NJ501-1300"},
		{130216, "New OMRON NB5Q-TW00B NB5QTW00B HMI Interactive Display In Box", "NB5Q-TW00B"},
		{130217, "Omron G9SA-501 PLC Module New In Box Fast Ship 1PCS", "G9SA-501"},
		{130218, "1PC Omron NX-TS3101 Temperature Sensor New In Box Fast Shipping NXTS3101", "NX-TS3101"},
		{130222, "Omron Programmable Controller CP1E-E40DR-A CP1EE40DRA Original New in Box NIB", "CP1E-E40DR-A"},
		{130223, "1PC New Omron E3FA-DP23 Photoelectric Sensor E3FADP23 Free Shipping", "E3FA-DP23"},
		{130224, "New OMRON CP1E-N30DT-D Programmable Controller MODULE", "CP1E-N30DT-D"},
		{130225, "NEW OMRON H5S-WFB2 Digital Time Switch", "H5S-WFB2"},
		{130226, "1PC Omron E5GN-R1TD Temperature Controller E5GNR1TD New Fast Shipping", "E5GN-R1TD"},
		{130230, "1 PCS NEW IN BOX OMRON Programmable controller CP1H-X40DT1-D", "CP1H-X40DT1-D"},
		{130231, "1PC OMRON NX-EC0132 Analog Input Unit New In Box Fast Shipping", "NX-EC0132"},
		{130232, "Omron NB3Q-TW00B HMI Touch Screen New One Fast Shipping NB3QTW00B", "NB3Q-TW00B"},
		{130233, "1Pcs New Omron F3SP-B1P Safety Relay Unit F3SPB1P", "F3SP-B1P"},
		{130235, "New Omron CRT1-OD16 Remote Terminal Module CRT1OD16 Communication Module", "CRT1-OD16"},
		{130236, "1PC New OMRON CJ1W-DA08C PLC Module CJ1WDA08C In Box Fast Shipping", "CJ1W-DA08C"},
		{130237, "New Omron E3X-NA41 Photoelectric Optical Fiber Sensor Switch E3XNA41 In Box 1PCS", "E3X-NA41"},
		{130238, "1PC New Omron NS10-TV01B-V2 Touch Screen In Box Fast Shipping", "NS10-TV01B-V2"},
		{130240, "Omron 1 PIECE new Sealed 3G3JZ-A4015 3G3JZA4015 Frequency Converter In Box", "3G3JZ-A4015"},
		{130241, "New Factory Sealed Omron NX-EIC202 NXEIC202 PLC Module New In Box", "NX-EIC202"},
		{130243, "New In Box Original Omron NX-AD2603 Analog Input Unit NX AD2603", "NX-AD2603"},
		{130247, "Omron H3CR-A8 Timer Module H3CRA8 New In Box Free Shipping", "H3CR-A8"},
		{130248, "1PC NEW IN BOX Omron Servo Motor R88M-G40030H-S<wbr/>2 R88M-G40030H-S<wbr/>2 FAST SHIP", "R88M-G40030H-S2"},
		{130249, "One For Omron CPM2A-60CDR-A PLC New Fast Shipping", "CPM2A-60CDR-A"},
		{130252, "1pc New In Box Original Omron NX-DA2605 PLC Module NX-DA2605", "NX-DA2605"},
		{130254, "ONE NEW Omron W4S1-03B", "W4S1-03B"},
		{130257, "OMRON 1P CP1E-N30DT-D Programmable Controller PLC Module Fast Shipping In Box", "CP1E-N30DT-D"},
		{130259, "New NX-OD5256 New in Original Omron NX-OD5256 Sealed Box FAST SHIP", "NX-OD5256"},
		{130260, "1 PCS NEW IN BOX OMRON Digital Unit NXRS1201 NX-RS1201 FAST SHIP NXRS1201", "NX-RS1201"},
		{130262, "Omron CP1E-N40DR-D Programmable Controller New One Fast Shipping CP1EN40DRD", "CP1E-N40DR-D"},
		{130264, "Omron V600-CA5D02 ID Controller Unit PLC DCS Controller Transmitter Transducer", "V600-CA5D02"},
		{130268, "OMRON E3S-CL2 Photoelectric Sensor Switch E3SCL2 New In Box Fast Shipping", "E3S-CL2"},
		{130269, "Omron CJ1W-PA205R Power Supply Module CJ1WPA205R New In Box #J", "CJ1W-PA205R"},
		{130271, "1PCS Omron DRT2-OD32ML DRT2OD32ML PLC Module New In Box Fast Shipping", "DRT2-OD32ML"},
		{130274, "One New Omron CJ1W-DA08C PLC Module In Box Fast Shipping", "CJ1W-DA08C"},
	}
	for _, tc := range cases {
		t.Run(strconv.FormatUint(uint64(tc.id), 10), func(t *testing.T) {
			model, confirmed := ExtractTitleIdentifier(tc.title)
			if model != tc.want {
				t.Fatalf("ExtractTitleIdentifier(%q) = %q, want %q", tc.title, model, tc.want)
			}
			if !confirmed {
				t.Fatalf("ExtractTitleIdentifier(%q) reported %q as unconfirmed; a family this table knows must be confirmed, or the draft is read as a guess", tc.title, model)
			}
		})
	}
}

// TestExtractTitleIdentifierKeepsLegacyFamiliesConfirmed pins the families the
// legacy table already parsed. The new passes run first, so a pattern added for
// Omron must not shadow a FANUC or Siemens listing.
func TestExtractTitleIdentifierKeepsLegacyFamiliesConfirmed(t *testing.T) {
	cases := []struct {
		title string
		want  string
	}{
		{"FANUC A06B-6079-H208 Servo Amplifier Module TESTED", "A06B-6079-H208"},
		{"Fanuc A02B-0120-C041 PCB Board free shipping", "A02B-0120-C041"},
		{"FANUC A860-2000-T301 Pulse Coder encoder", "A860-2000-T301"},
		{"Siemens 6ES7215-1AG40-0XB0 SIMATIC S7-1200 CPU 1215C", "6ES7215-1AG40-0XB0"},
		{"Mitsubishi MR-J4-40A MELSERVO Servo Drive 400W", "MR-J4-40A"},
		{"Yaskawa SGDV-2R8A01A Servo Pack tested working", "SGDV-2R8A01A"},
		{"Allen-Bradley 1756-L61 ControlLogix Processor unit", "1756-L61"},
		{"ABB DSQC-664 DSQC 664 module new", "DSQC-664"},
	}
	for _, tc := range cases {
		t.Run(tc.want, func(t *testing.T) {
			model, confirmed := ExtractTitleIdentifier(tc.title)
			if model != tc.want || !confirmed {
				t.Fatalf("ExtractTitleIdentifier(%q) = %q, confirmed=%v, want %q, confirmed=true", tc.title, model, confirmed, tc.want)
			}
		})
	}
}

// TestExtractTitleIdentifierReportsAnUnseenFamilyAsUnconfirmed documents what
// the guarded scan is for: a family no table knows still yields the part the
// listing names, so the draft can be reviewed, but the match is never presented
// as confirmed and is therefore never written to the draft as its identity.
func TestExtractTitleIdentifierReportsAnUnseenFamilyAsUnconfirmed(t *testing.T) {
	cases := []struct {
		name  string
		title string
		want  string
	}{
		{
			name:  "keyence amplifier",
			title: "Keyence FS-N18N Fiber Optic Sensor Amplifier New In Box Fast Shipping",
			want:  "FS-N18N",
		},
		{
			name:  "sick photoelectric sensor",
			title: "SICK WTB4-3P2161 Photoelectric Sensor New One Fast Shipping",
			want:  "WTB4-3P2161",
		},
		{
			name:  "unseen omron family",
			title: "One New Omron W8S1-99X PLC Module In Box Free Shipping 1PCS",
			want:  "W8S1-99X",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			model, confirmed := ExtractTitleIdentifier(tc.title)
			if model != tc.want {
				t.Fatalf("ExtractTitleIdentifier(%q) = %q, want %q", tc.title, model, tc.want)
			}
			if confirmed {
				t.Fatalf("ExtractTitleIdentifier(%q) reported %q as confirmed; an unseen family must stay a guess", tc.title, model)
			}
		})
	}
}

// TestExtractTitleIdentifierPrefersTheHyphenatedForm covers the reason the scan
// scores instead of taking the first token it sees. Sellers write the model twice,
// once with the separator and once without, and the hyphenated spelling is the
// canonical one.
func TestExtractTitleIdentifierPrefersTheHyphenatedForm(t *testing.T) {
	model, confirmed := ExtractTitleIdentifier("1PC Omron W8S1-03B W8S103B PLC Module In Box Free Shipping")
	if model != "W8S1-03B" {
		t.Fatalf("ExtractTitleIdentifier() = %q, want the hyphenated spelling W8S1-03B", model)
	}
	if confirmed {
		t.Fatalf("W8S1-03B is not in any family table, so it must be reported as unconfirmed")
	}
}

// TestExtractTitleIdentifierRejectsProse is the guard that keeps the scan usable
// on a title. Every one of these titles is made of the words a listing is mostly
// made of, and none of them names a part.
func TestExtractTitleIdentifierRejectsProse(t *testing.T) {
	prose := []string{
		"",
		"   ",
		"Lot of 5 FANUC Servo Motors USED",
		"NEW-2024-LOT industrial automation parts",
		"USED-AS-IS no returns accepted",
		"SHIPS-FROM-USA fast free delivery",
		"Free shipping worldwide, best price guarantee",
		"Tested and working, pulled from a working machine",
		"1PCS New In Box 100-240VAC 1 year warranty",
		"2PCS 24-240VAC/VDC Fast Shipping Free TAX",
		"1 year warranty New in box Omron Brand New Timer",
	}
	for _, title := range prose {
		t.Run(title, func(t *testing.T) {
			if model, confirmed := ExtractTitleIdentifier(title); model != "" || confirmed {
				t.Fatalf("ExtractTitleIdentifier(%q) = %q, confirmed=%v, want no match", title, model, confirmed)
			}
		})
	}
}
