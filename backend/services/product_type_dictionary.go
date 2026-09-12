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
