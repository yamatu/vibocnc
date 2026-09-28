package services

import "strings"

// ProductTypeDictionary is the canonical vocabulary used before category
// lookup/creation. Keys are normalized aliases; values are stable display names.
var ProductTypeDictionary = map[string]string{
	"servo amplifier": "Servo Amplifier / Drive", "servo drive": "Servo Amplifier / Drive", "servo amplifier / drive": "Servo Amplifier / Drive",
	"servo motor": "Servo Motor", "spindle motor": "Spindle Motor", "spindle drive": "Spindle Amplifier / Drive", "spindle amplifier / drive": "Spindle Amplifier / Drive",
	"plc": "Programmable Logic Controller", "programmable logic controller": "Programmable Logic Controller", "i/o module": "I/O Module", "io module": "I/O Module",
	"power supply": "Power Supply Unit", "power supply unit": "Power Supply Unit", "vfd": "Variable Frequency Drive", "variable frequency drive": "Variable Frequency Drive",
	"hmi": "Operator Panel / HMI", "operator panel": "Operator Panel / HMI", "operator panel / hmi": "Operator Panel / HMI", "encoder": "Encoder", "sensor": "Sensor",
	"photoelectric sensor": "Photoelectric Sensor", "proximity sensor": "Proximity Sensor", "cable": "Cable / Connector", "cable / connector": "Cable / Connector",
	"control board": "Control Board", "pcb board": "PCB Board", "battery": "Battery", "fan unit": "Fan Unit", "circuit breaker": "Circuit Breaker", "contactor": "Contactor",
}

func CanonicalProductType(value string) string {
	key := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " "))
	if canonical, ok := ProductTypeDictionary[key]; ok {
		return canonical
	}
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

// canonicalTypeAliasOverrides are the single-word aliases that are specific
// enough to survive a contains-match. The rest of the one-word vocabulary
// ("plc", "hmi", "sensor") is a modifier in real type names: matching them would
// turn "PLC Analog Output Module" into a controller and "Temperature Sensor"
// into a bare "Sensor".
var canonicalTypeAliasOverrides = map[string]bool{
	"encoder": true, "contactor": true, "battery": true, "servo motor": true,
}

// CanonicalizeProductTypeFromText maps a component type the model wrote in its
// own words onto the shared vocabulary when the text clearly names one of its
// types.
//
// The same kind of part arrives labelled differently from listing to listing
// ("Power Supply", "PLC Power Supply Module", "Power Supply Unit"), and every
// distinct wording used to become its own category node - one catalogue, three
// names for the same thing. Only a phrase long enough to be unambiguous is
// substituted, and the longest match wins, so a specific type ("Digital Output
// Unit", "EtherNet/IP Coupler Unit") is returned untouched and keeps meaning
// what it says.
func CanonicalizeProductTypeFromText(value string) string {
	trimmed := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if trimmed == "" {
		return ""
	}
	if canonical := CanonicalProductType(trimmed); canonical != trimmed {
		return canonical
	}
	needle := " " + strings.ToLower(trimmed) + " "
	best := ""
	bestLength := 0
	for alias, canonical := range ProductTypeDictionary {
		if len(alias) <= bestLength || !strings.Contains(alias, " ") && !canonicalTypeAliasOverrides[alias] {
			continue
		}
		if strings.Contains(needle, " "+alias+" ") {
			best = canonical
			bestLength = len(alias)
		}
	}
	if best != "" {
		return best
	}
	return trimmed
}
