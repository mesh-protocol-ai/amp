package main

import (
	"log"
	"os"
	"strconv"
)

func main() {
	publicHost := envOrDefault("PUBLIC_HOST", "localhost")
	controlPort := envIntOrDefault("CONTROL_PORT", 7000)
	dataPort := envIntOrDefault("DATA_PORT", 7001)
	portStart := envIntOrDefault("PORT_RANGE_START", 50100)
	portSize := envIntOrDefault("PORT_RANGE_SIZE", 100)

	relay := NewRelay(publicHost, controlPort, dataPort, portStart, portSize)
	relay.Start()

	log.Printf("relay: running (public_host=%s control=%d data=%d consumer_ports=%d-%d)",
		publicHost, controlPort, dataPort, portStart, portStart+portSize-1)

	// Block forever; listeners run in goroutines.
	select {}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envIntOrDefault(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
