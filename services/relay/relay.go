// Package main implements the AMP Data Plane Relay.
//
// The relay solves the NAT traversal problem for provider agents running behind
// firewalls or private networks. Rather than requiring providers to expose a
// public gRPC port, they connect outbound to the relay (which is publicly
// accessible) and keep a persistent control channel open. The relay then
// bridges incoming consumer gRPC connections to the appropriate provider.
//
// Protocol:
//
//	Provider → relay CONTROL_PORT:
//	  → "REGISTER {agent_did}\n"
//	  ← "OK {assigned_port}\n"
//	  → "PING\n"          (keepalive, sent periodically)
//	  ← "CONNECT {id}\n"  (relay asks provider to open a data channel)
//
//	Provider → relay DATA_PORT (new TCP connection per consumer):
//	  → "DATA {id}\n"     (matches the id from CONNECT above)
//
//	Consumer → relay assigned_port:
//	  [normal gRPC — relay pipes transparently]
package main

import (
	"bufio"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	// handshakeTimeout is the time allowed to receive REGISTER / DATA lines.
	handshakeTimeout = 10 * time.Second
	// providerIdleTimeout disconnects a provider that sends nothing for this long.
	providerIdleTimeout = 90 * time.Second
	// dataConnTimeout is the time the relay waits for the provider to open the
	// data connection after receiving CONNECT.
	dataConnTimeout = 15 * time.Second
)

// providerEntry holds the state of a connected provider.
type providerEntry struct {
	did    string
	conn   net.Conn
	mu     sync.Mutex
	writer *bufio.Writer
}

// sendConnect writes "CONNECT {id}\n" to the provider's control connection,
// asking it to open a data channel for this consumer connection.
func (p *providerEntry) sendConnect(connID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, err := fmt.Fprintf(p.writer, "CONNECT %s\n", connID); err != nil {
		return err
	}
	return p.writer.Flush()
}

// Relay is the core relay engine.
type Relay struct {
	// PublicHost is the hostname/IP consumers use to reach the relay.
	// It is included in log messages and returned by GRPCAddress.
	PublicHost string
	// ControlPort is where provider control connections arrive.
	ControlPort int
	// DataPort is where providers open per-consumer data connections.
	DataPort int
	// PortRangeStart and PortRangeSize define the consumer-facing port pool.
	PortRangeStart int
	PortRangeSize  int

	mu        sync.RWMutex
	providers map[string]*providerEntry  // did → entry
	pending   map[string]chan net.Conn   // connID → waiting slot
	listeners map[string]net.Listener   // did → consumer listener
}

// NewRelay creates a Relay with the given configuration.
func NewRelay(publicHost string, controlPort, dataPort, portStart, portSize int) *Relay {
	return &Relay{
		PublicHost:     publicHost,
		ControlPort:    controlPort,
		DataPort:       dataPort,
		PortRangeStart: portStart,
		PortRangeSize:  portSize,
		providers:      make(map[string]*providerEntry),
		pending:        make(map[string]chan net.Conn),
		listeners:      make(map[string]net.Listener),
	}
}

// AssignedPort returns the deterministic consumer-facing port for a provider DID.
// The same DID always maps to the same port within the configured range, so the
// provider can register the address in its Agent Card before connecting.
func (r *Relay) AssignedPort(did string) int {
	h := fnv.New32a()
	h.Write([]byte(did))
	return r.PortRangeStart + int(h.Sum32()%uint32(r.PortRangeSize))
}

// GRPCAddress returns the value a provider should put in Agent Card
// spec.endpoints.data_plane.grpc ("host:port").
func (r *Relay) GRPCAddress(did string) string {
	return fmt.Sprintf("%s:%d", r.PublicHost, r.AssignedPort(did))
}

// Start launches the control and data listeners in background goroutines.
func (r *Relay) Start() {
	go r.listenControl()
	go r.listenData()
}

// ── Control listener ────────────────────────────────────────────────────────

func (r *Relay) listenControl() {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", r.ControlPort))
	if err != nil {
		log.Fatalf("relay: control listen :%d: %v", r.ControlPort, err)
	}
	log.Printf("relay: control listener on :%d", r.ControlPort)
	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("relay: control accept: %v", err)
			continue
		}
		go r.handleControl(conn)
	}
}

func (r *Relay) handleControl(conn net.Conn) {
	defer conn.Close()

	// Read the REGISTER line with a strict deadline.
	conn.SetDeadline(time.Now().Add(handshakeTimeout)) //nolint:errcheck
	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		return
	}
	line := strings.TrimSpace(scanner.Text())

	if !strings.HasPrefix(line, "REGISTER ") {
		fmt.Fprintf(conn, "ERR expected REGISTER <did>\n") //nolint:errcheck
		return
	}
	did := strings.TrimSpace(strings.TrimPrefix(line, "REGISTER "))
	if did == "" {
		fmt.Fprintf(conn, "ERR empty did\n") //nolint:errcheck
		return
	}

	conn.SetDeadline(time.Time{}) // remove deadline after handshake

	port := r.AssignedPort(did)
	entry := &providerEntry{
		did:    did,
		conn:   conn,
		writer: bufio.NewWriter(conn),
	}

	// Replace any previous connection for this DID.
	r.mu.Lock()
	if old, exists := r.providers[did]; exists {
		log.Printf("relay: replacing existing connection for %s", did)
		old.conn.Close()
	}
	r.providers[did] = entry
	r.mu.Unlock()

	// Ensure a consumer listener is running for this provider's assigned port.
	r.ensureConsumerListener(did, port)

	fmt.Fprintf(conn, "OK %d\n", port) //nolint:errcheck
	log.Printf("relay: provider registered did=%s port=%d", did, port)

	// Keep the control connection alive; read and discard PING lines.
	buf := make([]byte, 64)
	for {
		conn.SetDeadline(time.Now().Add(providerIdleTimeout)) //nolint:errcheck
		_, err := conn.Read(buf)
		if err != nil {
			break
		}
	}

	r.mu.Lock()
	if r.providers[did] == entry {
		delete(r.providers, did)
	}
	r.mu.Unlock()
	log.Printf("relay: provider disconnected did=%s", did)
}

// ── Consumer listeners ───────────────────────────────────────────────────────

func (r *Relay) ensureConsumerListener(did string, port int) {
	r.mu.Lock()
	_, running := r.listeners[did]
	r.mu.Unlock()
	if running {
		return
	}

	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		log.Printf("relay: consumer listen :%d for %s: %v", port, did, err)
		return
	}

	r.mu.Lock()
	r.listeners[did] = ln
	r.mu.Unlock()

	log.Printf("relay: consumer listener for did=%s on :%d", did, port)
	go r.acceptConsumers(did, ln)
}

func (r *Relay) acceptConsumers(did string, ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("relay: consumer accept for %s: %v", did, err)
			return
		}
		go r.handleConsumer(did, conn)
	}
}

func (r *Relay) handleConsumer(did string, consumerConn net.Conn) {
	defer consumerConn.Close()

	r.mu.RLock()
	entry, ok := r.providers[did]
	r.mu.RUnlock()
	if !ok {
		log.Printf("relay: no provider connected for did=%s, dropping consumer", did)
		return
	}

	// Register a pending slot so the data connection can be matched.
	connID := uuid.Must(uuid.NewV7()).String()
	ch := make(chan net.Conn, 1)

	r.mu.Lock()
	r.pending[connID] = ch
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		delete(r.pending, connID)
		r.mu.Unlock()
	}()

	// Ask the provider to open a data connection.
	if err := entry.sendConnect(connID); err != nil {
		log.Printf("relay: sendConnect to %s failed: %v", did, err)
		return
	}

	// Wait for the provider's data connection.
	select {
	case dataConn := <-ch:
		defer dataConn.Close()
		log.Printf("relay: bridging consumer↔provider did=%s conn=%s", did, connID)
		pipeBidirectional(consumerConn, dataConn)
	case <-time.After(dataConnTimeout):
		log.Printf("relay: timeout waiting for data conn did=%s conn=%s", did, connID)
	}
}

// ── Data listener ────────────────────────────────────────────────────────────

func (r *Relay) listenData() {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", r.DataPort))
	if err != nil {
		log.Fatalf("relay: data listen :%d: %v", r.DataPort, err)
	}
	log.Printf("relay: data listener on :%d", r.DataPort)
	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("relay: data accept: %v", err)
			continue
		}
		go r.handleData(conn)
	}
}

func (r *Relay) handleData(conn net.Conn) {
	// Read "DATA {connID}\n" with a strict deadline.
	conn.SetDeadline(time.Now().Add(handshakeTimeout)) //nolint:errcheck
	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		conn.Close()
		return
	}
	line := strings.TrimSpace(scanner.Text())
	if !strings.HasPrefix(line, "DATA ") {
		conn.Close()
		return
	}
	connID := strings.TrimSpace(strings.TrimPrefix(line, "DATA "))
	conn.SetDeadline(time.Time{}) // remove deadline after handshake

	r.mu.RLock()
	ch, ok := r.pending[connID]
	r.mu.RUnlock()
	if !ok {
		log.Printf("relay: unknown or expired conn_id=%s", connID)
		conn.Close()
		return
	}

	select {
	case ch <- conn:
		// delivered; consumer goroutine takes ownership
	default:
		log.Printf("relay: conn_id=%s slot already filled, dropping", connID)
		conn.Close()
	}
}

// ── TCP pipe ─────────────────────────────────────────────────────────────────

// pipeBidirectional copies data in both directions until either side closes.
func pipeBidirectional(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		io.Copy(a, b) //nolint:errcheck
		closeWrite(a)
	}()
	go func() {
		defer wg.Done()
		io.Copy(b, a) //nolint:errcheck
		closeWrite(b)
	}()
	wg.Wait()
}

// closeWrite performs a TCP half-close when possible.
func closeWrite(c net.Conn) {
	if tc, ok := c.(*net.TCPConn); ok {
		tc.CloseWrite() //nolint:errcheck
	} else {
		c.Close()
	}
}
